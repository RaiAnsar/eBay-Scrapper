#!/usr/bin/env node

/**
 * WebSocket Server for eBay Scraper
 * Handles real-time scraping with progress updates
 */

const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3000;

// Serve static files
app.use(express.static(__dirname));

// Serve the web interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'web_interface.html'));
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📱 Open your browser and go to http://localhost:${PORT}`);
});

// WebSocket server
const wss = new WebSocket.Server({ server });

class ScraperSession {
    constructor(ws) {
        this.ws = ws;
        this.browser = null;
        this.page = null;
        this.isRunning = false;
        this.products = [];
        this.seenItems = new Set();
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
        
        // Set user agent to look like real Chrome
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

    sendMessage(data) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    log(message) {
        this.sendMessage({ type: 'log', message });
    }

    async extractProducts(pageNum) {
        return await this.page.evaluate((pageNum) => {
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
                    // Skip sponsored items ONLY if explicitly marked
                    const text = item.innerText || '';
                    if (text.includes('SPONSORED')) {
                        return;
                    }
                    
                    // Optional: Skip international sellers (currently disabled to get results)
                    // if (text.includes('from Germany') || 
                    //     text.includes('from Japan') || 
                    //     text.includes('from Malaysia') ||
                    //     text.includes('from Austria') ||
                    //     text.includes('international postage') ||
                    //     text.includes('Free international')) {
                    //     return;
                    // }
                    
                    const link = item.querySelector('a[href*="/itm/"]');
                    if (!link) return;
                    
                    const href = link.href;
                    const itemMatch = href.match(/\/itm\/(\d+)/);
                    if (!itemMatch) return;
                    
                    // Extract all fields
                    const product = {
                        Title: '',
                        Price: '',
                        Ebay_Item_Number: itemMatch[1],
                        Condition: '',
                        Shipping: '',
                        URL: `https://www.ebay.co.uk/itm/${itemMatch[1]}`,
                        Page: pageNum
                    };
                    
                    // Title - try multiple selectors
                    const titleSelectors = [
                        'a[href*="/itm/"] span',  // Most reliable for search results
                        '.s-item__link span',
                        'h3.s-item__title',
                        'h3 .s-item__title',
                        '.s-item__title span[role="heading"]',
                        'span[role="heading"]',
                        'h3',
                        '.s-item__title',
                        '.vip'
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
                    
                    // Condition - look for specific patterns
                    const spans = item.querySelectorAll('span');
                    for (const span of spans) {
                        const text = (span.innerText || span.textContent || '').trim();
                        if (text === 'Brand new' || text === 'Used' || text === 'Like new' || 
                            text === 'Very good' || text === 'Good' || text === 'Acceptable') {
                            product.Condition = text;
                            break;
                        }
                    }
                    
                    // Shipping - look for postage/shipping text
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
                            images.push(img.src.replace(/s-l\d+/, 's-l500'));
                        }
                    });
                    
                    product.Image_URL_1 = images[0] || '';
                    product.Image_URL_2 = images[1] || '';
                    product.Image_URL_3 = images[2] || '';
                    product.Image_URL_4 = images[3] || '';
                    
                    if (product.Title) {
                        items.push(product);
                    }
                } catch (e) {
                    console.error('Error extracting item:', e);
                }
            });
            
            return items;
        }, pageNum);
    }

    async scrape(request) {
        this.isRunning = true;
        await this.init();
        
        const { url, maxPages, itemsPerPage, filters, skipSponsored, removeDuplicates } = request;
        
        // Build URL if needed
        let scrapeUrl = url;
        if (!url.startsWith('http')) {
            // Build URL from keywords
            scrapeUrl = `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(url)}`;
            if (itemsPerPage) scrapeUrl += `&_ipg=${itemsPerPage}`;
            if (filters.ukOnly) scrapeUrl += '&LH_PrefLoc=1';
            if (filters.buyItNow) scrapeUrl += '&LH_BIN=1';
            if (filters.freeShipping) scrapeUrl += '&LH_FS=1';
            if (filters.newCondition) scrapeUrl += '&LH_ItemCondition=1000';
            if (filters.minPrice) scrapeUrl += `&_udlo=${filters.minPrice}`;
            if (filters.maxPrice) scrapeUrl += `&_udhi=${filters.maxPrice}`;
        } else if (itemsPerPage && !url.includes('_ipg=')) {
            // Add items per page to existing URL if not already present
            scrapeUrl += (url.includes('?') ? '&' : '?') + `_ipg=${itemsPerPage}`;
        }
        
        this.log(`Starting scrape: ${scrapeUrl}`);
        
        for (let page = 1; page <= maxPages && this.isRunning; page++) {
            try {
                const pageUrl = page === 1 ? scrapeUrl : `${scrapeUrl}&_pgn=${page}`;
                
                this.log(`Loading page ${page}...`);
                await this.page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const products = await this.extractProducts(page);
                
                // Filter duplicates if requested
                let newProducts = products;
                if (removeDuplicates) {
                    newProducts = products.filter(p => !this.seenItems.has(p.Ebay_Item_Number));
                    products.forEach(p => this.seenItems.add(p.Ebay_Item_Number));
                }
                
                // Add timestamp
                newProducts.forEach(p => {
                    p.Scraped_At = new Date().toISOString().slice(0, 19).replace('T', ' ');
                    p.EAN = '';
                    p.Description = '';
                });
                
                this.products.push(...newProducts);
                
                // Send products to frontend
                newProducts.forEach(product => {
                    this.sendMessage({ type: 'product', product });
                });
                
                // Send progress update
                this.sendMessage({
                    type: 'progress',
                    currentPage: page,
                    totalPages: maxPages,
                    totalProducts: products.length,
                    uniqueProducts: this.products.length
                });
                
                this.log(`Page ${page}: Found ${products.length} products (${newProducts.length} new)`);
                
                if (products.length === 0) {
                    this.log('No more products found, stopping...');
                    break;
                }
                
            } catch (error) {
                this.log(`Error on page ${page}: ${error.message}`);
            }
        }
        
        this.sendMessage({
            type: 'complete',
            totalProducts: this.products.length
        });
        
        await this.cleanup();
    }

    async cleanup() {
        this.isRunning = false;
        if (this.browser) {
            await this.browser.close();
        }
    }

    stop() {
        this.isRunning = false;
        this.log('Scraping stopped by user');
        this.cleanup();
    }
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('New client connected');
    
    const session = new ScraperSession(ws);
    
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'start':
                session.scrape(data);
                break;
            case 'stop':
                session.stop();
                break;
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        session.cleanup();
    });
});