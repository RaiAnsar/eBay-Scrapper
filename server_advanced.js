#!/usr/bin/env node

/**
 * Advanced eBay Scraper Server
 * - Multiple URLs support (one per line)
 * - Concurrent scraping
 * - Separate files per search
 * - Real-time progress per task
 * - Background operation
 */

const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const xlsx = require('xlsx');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3000;

app.use(express.static(__dirname));
app.use('/results', express.static(path.join(__dirname, 'results')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'web_interface_advanced.html'));
});

// Add endpoint to list available result files
app.get('/api/results', async (req, res) => {
    try {
        await fs.mkdir('results', { recursive: true });
        const files = await fs.readdir('results');
        const resultFiles = files.filter(f => f.endsWith('.xlsx') || f.endsWith('.json'));
        res.json(resultFiles);
    } catch (error) {
        res.json([]);
    }
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Advanced Server running at http://localhost:${PORT}`);
    console.log(`📱 Open your browser and go to http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server });

// Store active scraping sessions
const activeSessions = new Map();

class ScraperTask {
    constructor(id, url, options, ws) {
        this.id = id;
        this.url = url;
        this.options = options;
        this.ws = ws;
        this.browser = null;
        this.page = null;
        this.isRunning = false;
        this.products = [];
        this.seenItems = new Set();
        this.currentPage = 0;
        this.totalPages = 0;
        this.startTime = Date.now();
    }

    sendUpdate(type, data) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'task_update',
                taskId: this.id,
                updateType: type,
                ...data
            }));
        }
    }

    extractSearchTerm() {
        // Extract search term from URL for filename
        const urlObj = new URL(this.url);
        const nkw = urlObj.searchParams.get('_nkw') || 'ebay_products';
        const genre = urlObj.searchParams.get('Genre') || '';
        const category = urlObj.searchParams.get('_sacat') || '';
        
        let filename = nkw.replace(/[^a-z0-9]/gi, '_');
        if (genre) filename += `_${genre}`;
        if (category && category !== '0') filename += `_cat${category}`;
        
        return filename.toLowerCase();
    }

    async init() {
        this.browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1920, height: 1080 });
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Remove webdriver flag
        await this.page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
        });
        
        // Block images to save bandwidth
        await this.page.setRequestInterception(true);
        this.page.on('request', (req) => {
            if (req.resourceType() === 'image' || req.resourceType() === 'stylesheet') {
                req.abort();
            } else {
                req.continue();
            }
        });
    }

    async extractProductDetails(itemNumber) {
        try {
            const detailUrl = `https://www.ebay.co.uk/itm/${itemNumber}`;
            const detailPage = await this.browser.newPage();
            
            await detailPage.setViewport({ width: 1920, height: 1080 });
            await detailPage.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Block images to speed up
            await detailPage.setRequestInterception(true);
            detailPage.on('request', (req) => {
                if (req.resourceType() === 'image' || req.resourceType() === 'stylesheet') {
                    req.abort();
                } else {
                    req.continue();
                }
            });
            
            await detailPage.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const details = await detailPage.evaluate(() => {
                let ean = '';
                let description = '';
                
                // Try to find EAN
                const specsSection = document.querySelector('.ux-layout-section--itemspecs');
                if (specsSection) {
                    const rows = specsSection.querySelectorAll('.ux-labels-values__labels-content');
                    rows.forEach(row => {
                        const label = row.querySelector('.ux-labels-values__labels')?.innerText || '';
                        if (label.toLowerCase().includes('ean') || label.toLowerCase().includes('gtin')) {
                            ean = row.querySelector('.ux-labels-values__values')?.innerText?.trim() || '';
                        }
                    });
                }
                
                // Also check in item specifics section
                if (!ean) {
                    const allText = document.body.innerText;
                    const eanMatch = allText.match(/EAN[:\s]+(\d{13})/i);
                    if (eanMatch) ean = eanMatch[1];
                }
                
                // Get description
                const descSection = document.querySelector('.ux-expandable-textual-display-block-inline__text, .vim.d-item-description, [data-testid="item-description"]');
                if (descSection) {
                    description = descSection.innerText?.trim() || '';
                    // Limit description length
                    if (description.length > 500) {
                        description = description.substring(0, 500) + '...';
                    }
                }
                
                return { ean, description };
            });
            
            await detailPage.close();
            return details;
        } catch (error) {
            console.error(`Error extracting details for item ${itemNumber}:`, error.message);
            return { ean: '', description: '' };
        }
    }

    async extractProducts(pageNum, imageQuality = 800) {
        return await this.page.evaluate((pageNum, imageQuality) => {
            const items = [];
            
            // Try different selector patterns
            let productElements = document.querySelectorAll('.srp-results li[id^="item"]');
            
            if (productElements.length === 0) {
                productElements = document.querySelectorAll('li[data-viewport]');
            }
            
            if (productElements.length === 0) {
                productElements = document.querySelectorAll('.s-item');
            }
            
            productElements.forEach((item, index) => {
                try {
                    const text = item.innerText || '';
                    if (text.includes('SPONSORED')) {
                        return;
                    }
                    
                    const link = item.querySelector('a[href*="/itm/"]');
                    if (!link) return;
                    
                    const href = link.href;
                    const itemMatch = href.match(/\/itm\/(\d+)/);
                    if (!itemMatch) return;
                    
                    const product = {
                        Title: '',
                        Price: '',
                        Ebay_Item_Number: itemMatch[1],
                        Condition: '',
                        Shipping: '',
                        URL: `https://www.ebay.co.uk/itm/${itemMatch[1]}`,
                        Page: pageNum
                    };
                    
                    // Title
                    const titleSelectors = [
                        'a[href*="/itm/"] span',
                        '.s-item__link span',
                        'h3.s-item__title',
                        'h3',
                        '.s-item__title',
                        'span[role="heading"]'
                    ];
                    
                    for (const selector of titleSelectors) {
                        const elem = item.querySelector(selector);
                        if (elem && elem.innerText && elem.innerText.trim()) {
                            product.Title = elem.innerText.trim();
                            break;
                        }
                    }
                    
                    // Price
                    const priceElem = item.querySelector('span[class*="price"], .s-item__price, .lvprice');
                    if (priceElem) product.Price = priceElem.innerText.trim();
                    
                    // Condition
                    const spans = item.querySelectorAll('span');
                    for (const span of spans) {
                        const text = (span.innerText || span.textContent || '').trim();
                        if (text === 'Brand new' || text === 'Used' || text === 'Like new' || 
                            text === 'Very good' || text === 'Good' || text === 'Acceptable') {
                            product.Condition = text;
                            break;
                        }
                    }
                    
                    // Shipping
                    for (const span of spans) {
                        const text = (span.innerText || span.textContent || '').trim();
                        if ((text.includes('postage') || text.includes('shipping')) && 
                            !text.includes('from') && text.length < 50) {
                            product.Shipping = text;
                            break;
                        }
                    }
                    
                    // Images
                    const images = [];
                    item.querySelectorAll('img[src*="ebayimg"]').forEach((img, i) => {
                        if (i < 4 && img.src && !img.src.includes('pixel')) {
                            images.push(img.src.replace(/s-l\d+/, `s-l${imageQuality}`));
                        }
                    });
                    
                    product.Image_URL_1 = images[0] || '';
                    product.Image_URL_2 = images[1] || '';
                    product.Image_URL_3 = images[2] || '';
                    product.Image_URL_4 = images[3] || '';
                    
                    // EAN - leave empty for now, would need to visit product page
                    product.EAN = '';
                    
                    // Description - leave empty for now, would need to visit product page  
                    product.Description = '';
                    
                    if (product.Title) {
                        items.push(product);
                    }
                } catch (e) {
                    console.error('Error extracting item:', e);
                }
            });
            
            return items;
        }, pageNum, imageQuality);
    }

    async scrape() {
        this.isRunning = true;
        this.sendUpdate('status', { status: 'initializing' });
        
        try {
            await this.init();
            
            // Add items per page to URL if not present
            let scrapeUrl = this.url;
            if (this.options.itemsPerPage && !scrapeUrl.includes('_ipg=')) {
                scrapeUrl += (scrapeUrl.includes('?') ? '&' : '?') + `_ipg=${this.options.itemsPerPage}`;
            }
            
            this.sendUpdate('status', { 
                status: 'loading_first_page',
                url: scrapeUrl 
            });
            
            // Load first page to get total count (with retry)
            let retries = 3;
            while (retries > 0) {
                try {
                    await this.page.goto(scrapeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) throw error;
                    this.sendUpdate('status', { status: 'retrying', message: `Retrying... (${3 - retries}/3)` });
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
            
            // Get total results and check page content
            const pageInfo = await this.page.evaluate(() => {
                const heading = document.querySelector('h1.srp-controls__count-heading');
                const currentUrl = window.location.href;
                
                // Debug info
                console.log('Current URL:', currentUrl);
                console.log('Heading found:', heading?.innerText);
                
                let totalResults = 0;
                if (heading) {
                    const match = heading.innerText.match(/([\d,]+)\+?\s+results?/i);
                    if (match) {
                        totalResults = parseInt(match[1].replace(/,/g, ''));
                    }
                }
                
                // Check for location issues
                const noResultsMsg = document.querySelector('.srp-save-null-search__heading');
                const intlSellers = Array.from(document.querySelectorAll('h2, h3')).find(el => 
                    el.innerText?.includes('international sellers')
                );
                
                return {
                    totalResults,
                    url: currentUrl,
                    noResultsMsg: noResultsMsg?.innerText,
                    intlSellers: intlSellers?.innerText,
                    headingText: heading?.innerText
                };
            });
            
            console.log('Page info:', pageInfo);
            const totalResults = pageInfo.totalResults;
            
            const itemsPerPage = this.options.itemsPerPage || 60;
            
            // If maxPages is 0, scrape all available pages
            if (this.options.maxPages === 0) {
                this.totalPages = Math.ceil(totalResults / itemsPerPage);
            } else {
                this.totalPages = Math.min(
                    Math.ceil(totalResults / itemsPerPage),
                    this.options.maxPages
                );
            }
            
            this.sendUpdate('status', { 
                status: 'scraping',
                totalResults: totalResults,
                estimatedPages: this.totalPages
            });
            
            // Scrape pages
            for (let page = 1; page <= this.totalPages && this.isRunning; page++) {
                this.currentPage = page;
                
                if (page > 1) {
                    const pageUrl = scrapeUrl + `&_pgn=${page}`;
                    await this.page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
                
                const products = await this.extractProducts(page, this.options.imageQuality || 800);
                
                // Filter duplicates
                let newProducts = products;
                if (this.options.removeDuplicates) {
                    newProducts = products.filter(p => !this.seenItems.has(p.Ebay_Item_Number));
                    products.forEach(p => this.seenItems.add(p.Ebay_Item_Number));
                }
                
                // Fetch EAN and Description if requested
                if (this.options.extractEAN || this.options.extractDescription) {
                    this.sendUpdate('status', { 
                        status: 'fetching_details',
                        message: `Fetching details for ${newProducts.length} products from page ${page}`
                    });
                    
                    for (let i = 0; i < newProducts.length; i++) {
                        const product = newProducts[i];
                        if (product.Ebay_Item_Number) {
                            const details = await this.extractProductDetails(product.Ebay_Item_Number);
                            if (this.options.extractEAN) product.EAN = details.ean;
                            if (this.options.extractDescription) product.Description = details.description;
                            
                            // Send progress update for details fetching
                            if (i % 5 === 0) {
                                this.sendUpdate('detail_progress', {
                                    currentItem: i + 1,
                                    totalItems: newProducts.length,
                                    page: page
                                });
                            }
                        }
                    }
                }
                
                // Add timestamp
                newProducts.forEach(p => {
                    p.Scraped_At = new Date().toISOString().slice(0, 19).replace('T', ' ');
                });
                
                this.products.push(...newProducts);
                
                // Send progress update
                this.sendUpdate('progress', {
                    currentPage: page,
                    totalPages: this.totalPages,
                    pageProducts: products.length,
                    newProducts: newProducts.length,
                    totalProducts: this.products.length,
                    productsPerSecond: Math.round(this.products.length / ((Date.now() - this.startTime) / 1000))
                });
                
                if (products.length === 0) {
                    break; // No more products
                }
            }
            
            // Save results
            await this.saveResults();
            
            this.sendUpdate('complete', {
                totalProducts: this.products.length,
                duration: Date.now() - this.startTime,
                filename: this.extractSearchTerm()
            });
            
        } catch (error) {
            this.sendUpdate('error', {
                message: error.message
            });
        } finally {
            await this.cleanup();
        }
    }

    async saveResults() {
        const filename = this.extractSearchTerm();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        
        // Save JSON
        const jsonFile = `results/${filename}_${timestamp}.json`;
        await fs.mkdir('results', { recursive: true });
        await fs.writeFile(jsonFile, JSON.stringify(this.products, null, 2));
        
        // Save Excel
        const xlsxFile = `results/${filename}_${timestamp}.xlsx`;
        
        const requiredCols = [
            'Title', 'Price', 'Ebay_Item_Number', 'EAN', 'Description',
            'Image_URL_1', 'Image_URL_2', 'Image_URL_3', 'Image_URL_4',
            'Condition', 'Shipping', 'URL', 'Scraped_At'
        ];
        
        const formattedProducts = this.products.map(p => {
            const formatted = {};
            requiredCols.forEach(col => {
                formatted[col] = p[col] || '';
            });
            return formatted;
        });
        
        const ws = xlsx.utils.json_to_sheet(formattedProducts);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, 'Products');
        xlsx.writeFile(wb, xlsxFile);
        
        this.sendUpdate('files_saved', {
            jsonFile,
            xlsxFile
        });
    }

    async cleanup() {
        this.isRunning = false;
        if (this.browser) {
            await this.browser.close();
        }
    }

    stop() {
        this.isRunning = false;
        this.sendUpdate('status', { status: 'stopped' });
        this.cleanup();
    }
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'start_multi':
                // Parse multiple URLs
                const urls = data.urls.split('\n')
                    .map(url => url.trim())
                    .filter(url => url.length > 0 && (url.startsWith('http') || url.includes('ebay')));
                
                ws.send(JSON.stringify({
                    type: 'multi_start',
                    totalTasks: urls.length
                }));
                
                // Start concurrent scraping tasks
                urls.forEach((url, index) => {
                    const taskId = `task_${Date.now()}_${index}`;
                    const task = new ScraperTask(taskId, url, data.options, ws);
                    activeSessions.set(taskId, task);
                    
                    // Start scraping (runs in background)
                    task.scrape().catch(console.error);
                });
                break;
                
            case 'stop_task':
                const task = activeSessions.get(data.taskId);
                if (task) {
                    task.stop();
                    activeSessions.delete(data.taskId);
                }
                break;
                
            case 'stop_all':
                activeSessions.forEach(task => task.stop());
                activeSessions.clear();
                break;
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        // Stop all tasks for this client
        activeSessions.forEach(task => {
            if (task.ws === ws) {
                task.cleanup();
            }
        });
    });
});