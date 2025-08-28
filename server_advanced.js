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
const fsSync = require('fs');
const xlsx = require('xlsx');

puppeteer.use(StealthPlugin());

// Debug logging to file
function debugLog(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} ${message}\n`;
    try {
        fsSync.appendFileSync('./debug.log', logMessage);
    } catch (e) {
        // Ignore file errors
    }
    console.log(message);
}

const app = express();
const PORT = 3001;

app.use(express.static(__dirname));
app.use('/results', express.static(path.join(__dirname, 'results')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'web_interface_minimal.html'));
});
app.get('/results', (req, res) => {
    res.sendFile(path.join(__dirname, 'results.html'));
});

// Add endpoint to list available result files
app.get('/api/results', async (req, res) => {
    try {
        await fs.mkdir(path.join(__dirname, 'results'), { recursive: true });
        const files = await fs.readdir(path.join(__dirname, 'results'));
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

// Task queue system to prevent concurrent browser crashes
const MAX_CONCURRENT_BROWSERS = 1; // Only allow 1 browser at a time
const taskQueue = [];
let activeBrowserCount = 0;

// Task persistence
const TASKS_FILE = './tasks_state.json';

async function saveTasks() {
    try {
        const tasks = Array.from(activeSessions.entries()).map(([id, task]) => ({
            id,
            url: task.url,
            options: task.options,
            isRunning: task.isRunning,
            currentPage: task.currentPage,
            totalPages: task.totalPages,
            products: task.products.length,
            startTime: task.startTime,
            searchTerm: task.extractSearchTerm()
        }));
        await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2));
    } catch (error) {
        console.error('Error saving tasks:', error);
    }
}

async function loadTasks() {
    try {
        const data = await fs.readFile(TASKS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Process task queue
async function processTaskQueue() {
    debugLog(`[QUEUE] Processing queue. Active: ${activeBrowserCount}/${MAX_CONCURRENT_BROWSERS}, Queue: ${taskQueue.length}`);
    
    while (activeBrowserCount < MAX_CONCURRENT_BROWSERS && taskQueue.length > 0) {
        const task = taskQueue.shift();
        if (task) {
            activeBrowserCount++;
            debugLog(`[QUEUE] Starting task ${task.id}. Active browsers: ${activeBrowserCount}`);
            
            // Start the task without blocking the queue
            task.startScraping().finally(() => {
                activeBrowserCount--;
                debugLog(`[QUEUE] Task ${task.id} finished. Active browsers: ${activeBrowserCount}`);
                // Process next task in queue
                processTaskQueue();
            });
        }
    }
}

class ScraperTask {
    constructor(id, url, options, ws) {
        this.id = id;
        this.url = url;
        this.options = options;
        this.ws = ws;
        this.browser = null;
        this.page = null;
        this.isRunning = false;
        this.isPaused = false;
        this.products = [];
        this.seenItems = new Set();
        this.currentPage = 0;
        this.totalPages = 0;
        this.startTime = Date.now();
        this.retryCount = 0;
        this.maxRetries = 3;
        this.blockDetected = false;
    }

    sendUpdate(type, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'task_update',
                taskId: this.id,
                updateType: type,
                ...data
            }));
        }
        
        // Save task state after updates
        if (type === 'progress' || type === 'complete' || type === 'error') {
            saveTasks();
        }
    }
    
    getState() {
        return {
            id: this.id,
            url: this.url,
            options: this.options,
            isRunning: this.isRunning,
            currentPage: this.currentPage,
            totalPages: this.totalPages,
            productsCount: this.products.length,
            totalProducts: this.products.length,
            startTime: this.startTime,
            searchTerm: this.extractSearchTerm(),
            status: this.isRunning ? 'running' : 'stopped',
            isPaused: this.isPaused,
            extractionProgress: this.extractionProgress || null
        };
    }
    
    setWebSocket(ws) {
        this.ws = ws;
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
        
        // Capture console logs from the page
        this.page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[PAGE]') || text.includes('[EXTRACT]')) {
                console.log('Browser Console:', text);
            }
        });
        
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

    async extractProductDetails() {
        const totalItems = this.products.length;
        debugLog(`[EXTRACT_DETAILS] Processing ${totalItems} products for EAN/Description`);
        
        for (let i = 0; i < totalItems && this.isRunning; i++) {
            // Check if paused
            await this.waitIfPaused();
            
            const product = this.products[i];
            
            // Skip if already has ALL requested details
            const hasEAN = !this.options.extractEAN || product.EAN;
            const hasDescription = !this.options.extractDescription || product.Description;
            
            if (hasEAN && hasDescription) {
                continue;
            }
            
            // Create a new page for each product to avoid frame detachment
            let productPage = null;
            
            try {
                // Add delay to avoid rate limiting (2-4 seconds between products)
                if (i > 0) {
                    const delay = 2000 + Math.random() * 2000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                
                // Send progress update
                if (i % 5 === 0) {  // Update every 5 items
                    this.extractionProgress = {
                        currentItem: i + 1,
                        totalItems: totalItems
                    };
                    this.sendUpdate('extracting', {
                        currentItem: i + 1,
                        totalItems: totalItems,
                        page: Math.floor(i / 240) + 1
                    });
                }
                
                // Create new page for this product
                productPage = await this.browser.newPage();
                await productPage.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                
                // Navigate to product page
                await productPage.goto(product.URL, { 
                    waitUntil: 'domcontentloaded', 
                    timeout: 30000 
                });
                
                // Extract details from product page
                const details = await productPage.evaluate(() => {
                    const result = { EAN: '', Description: '' };
                    
                    // Extract EAN
                    const eanElement = Array.from(document.querySelectorAll('.ux-labels-values__labels'))
                        .find(el => el.textContent?.includes('EAN'));
                    if (eanElement) {
                        const valueElement = eanElement.nextElementSibling;
                        if (valueElement) {
                            result.EAN = valueElement.textContent.trim();
                        }
                    }
                    
                    // Extract Description (first 500 chars)
                    // Try multiple selectors for description
                    const descSelectors = [
                        'div.item-description',  // User-provided specific selector
                        '.item-description',
                        '.vim__description-content',
                        '.d-item-description iframe',
                        '[data-testid="d-item-description"] iframe',
                        '.ux-expandable-textual-display-body',
                        '.ux-expandable-textual-display__preview',
                        '[data-testid="ux-textual-display"]',
                        '.vim-description-content',
                        '.d-item-description'
                    ];
                    
                    for (const selector of descSelectors) {
                        const elem = document.querySelector(selector);
                        if (elem) {
                            // Handle iframes
                            if (elem.tagName === 'IFRAME') {
                                try {
                                    const iframeDoc = elem.contentDocument || elem.contentWindow.document;
                                    const bodyText = iframeDoc.body.innerText || iframeDoc.body.textContent;
                                    if (bodyText && bodyText.trim()) {
                                        result.Description = bodyText.trim().substring(0, 500);
                                        break;
                                    }
                                } catch (e) {
                                    // Cross-origin iframe, can't access
                                }
                            } else {
                                const text = elem.innerText || elem.textContent;
                                if (text && text.trim()) {
                                    result.Description = text.trim().substring(0, 500);
                                    break;
                                }
                            }
                        }
                    }
                    
                    return result;
                });
                
                // Update product with details
                if (this.options.extractEAN) product.EAN = details.EAN;
                if (this.options.extractDescription) product.Description = details.Description;
                
            } catch (error) {
                debugLog(`[EXTRACT_DETAILS] Error extracting details for item ${i}: ${error.message}`);
                // Continue with next product but check if page is still valid
                if (error.message.includes('Target closed') || error.message.includes('Session closed')) {
                    debugLog(`[EXTRACT_DETAILS] Browser crashed, stopping extraction`);
                    break;
                }
            } finally {
                // Always close the product page to prevent memory leaks
                if (productPage) {
                    try {
                        await productPage.close();
                    } catch (e) {
                        // Ignore close errors
                    }
                }
            }
        }
        
        debugLog(`[EXTRACT_DETAILS] Completed processing ${totalItems} products`);
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
            
            console.log('[EXTRACT] Found', productElements.length, 'product elements on page', pageNum);
            
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

    async startScraping() {
        debugLog(`[SCRAPE START] URL: ${this.url}, Options: ${JSON.stringify(this.options)}`);
        this.isRunning = true;
        this.sendUpdate('status', { status: 'scraping' });
        
        try {
            await this.init();
            console.log('[SCRAPE] Browser initialized');
            
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
                
                // Debug info - MORE detailed
                console.log('[PAGE] Current URL:', currentUrl);
                console.log('[PAGE] Heading found:', heading?.innerText);
                console.log('[PAGE] Page title:', document.title);
                console.log('[PAGE] Body text sample:', document.body.innerText.substring(0, 200));
                
                let totalResults = 0;
                if (heading) {
                    const match = heading.innerText.match(/([\d,]+)\+?\s+results?/i);
                    if (match) {
                        totalResults = parseInt(match[1].replace(/,/g, ''));
                    }
                }
                
                // Check for products regardless of count
                let productElements = document.querySelectorAll('.srp-results li[id^="item"]');
                if (productElements.length === 0) {
                    productElements = document.querySelectorAll('li[data-viewport]');
                }
                if (productElements.length === 0) {
                    productElements = document.querySelectorAll('.s-item');
                }
                
                // Check for location issues
                const noResultsMsg = document.querySelector('.srp-save-null-search__heading');
                const intlSellers = Array.from(document.querySelectorAll('h2, h3')).find(el => 
                    el.innerText?.includes('international sellers')
                );
                
                console.log('[PAGE] Product elements found:', productElements.length);
                
                return {
                    totalResults,
                    url: currentUrl,
                    noResultsMsg: noResultsMsg?.innerText,
                    intlSellers: intlSellers?.innerText,
                    headingText: heading?.innerText,
                    productCount: productElements.length,
                    pageTitle: document.title
                };
            });
            
            debugLog('[SCRAPE] Page info: ' + JSON.stringify(pageInfo));
            
            // If we see products but totalResults is 0, use the product count
            const totalResults = pageInfo.totalResults || (pageInfo.productCount * 100);
            
            const itemsPerPage = this.options.itemsPerPage || 60;
            
            // Calculate total pages
            if (totalResults === 0) {
                console.log('[SCRAPE] WARNING: No total results found, will try to extract products anyway');
                // Default to user's maxPages or 100 if no results count found
                this.totalPages = this.options.maxPages || 100;
            } else if (this.options.maxPages === 0) {
                // If maxPages is 0, scrape all available pages
                this.totalPages = Math.ceil(totalResults / itemsPerPage);
                debugLog(`[SCRAPE] maxPages=0, will scrape all ${this.totalPages} pages`);
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
            
            debugLog(`[SCRAPE] Starting to scrape ${this.totalPages} pages (totalResults: ${totalResults}, itemsPerPage: ${itemsPerPage})`);
            
            // Scrape pages
            for (let page = 1; page <= this.totalPages && this.isRunning; page++) {
                // Check if paused
                await this.waitIfPaused();
                
                this.currentPage = page;
                debugLog(`[SCRAPE] Processing page ${page}/${this.totalPages}`);
                
                if (page > 1) {
                    const pageUrl = scrapeUrl + `&_pgn=${page}`;
                    debugLog(`[SCRAPE] Navigating to page ${page}: ${pageUrl}`);
                    
                    try {
                        await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        
                        // Check for bot detection
                        const currentUrl = await this.page.url();
                        const pageTitle = await this.page.title();
                        if (currentUrl.includes('splashui/challenge') || currentUrl.includes('captcha') || pageTitle.includes('interruption')) {
                            debugLog(`[BOT_DETECT] eBay bot detection on page ${page}. Waiting 2 minutes...`);
                            this.sendUpdate('status', { 
                                status: 'paused',
                                message: '🤖 Bot detected! Waiting 2 minutes...',
                                currentPage: page
                            });
                            
                            // Wait 2 minutes
                            await new Promise(resolve => setTimeout(resolve, 120000));
                            
                            // Try navigating again
                            debugLog(`[BOT_DETECT] Retrying after wait...`);
                            await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            
                            // Check if still blocked
                            const urlAfterWait = await this.page.url();
                            if (urlAfterWait.includes('splashui/challenge') || urlAfterWait.includes('captcha')) {
                                debugLog(`[BOT_DETECT] Still blocked. Stopping at page ${page}`);
                                this.sendUpdate('status', { 
                                    status: 'stopped',
                                    message: 'Stopped due to persistent bot detection',
                                    currentPage: page
                                });
                                break;
                            }
                        }
                    } catch (navError) {
                        debugLog(`[SCRAPE] Navigation error on page ${page}: ${navError.message}`);
                        // Retry once
                        await new Promise(resolve => setTimeout(resolve, 10000));
                        try {
                            await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        } catch (retryError) {
                            debugLog(`[SCRAPE] Retry failed for page ${page}, skipping`);
                            continue;
                        }
                    }
                }
                
                const products = await this.extractProducts(page, this.options.imageQuality || 800);
                
                // Filter duplicates
                let newProducts = products;
                if (this.options.removeDuplicates) {
                    newProducts = products.filter(p => !this.seenItems.has(p.Ebay_Item_Number));
                    products.forEach(p => this.seenItems.add(p.Ebay_Item_Number));
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
                    debugLog(`[SCRAPE] No products found on page ${page}`);
                    
                    // Track consecutive empty pages
                    if (!this.emptyPageCount) this.emptyPageCount = 0;
                    this.emptyPageCount++;
                    
                    // Only stop after 3 consecutive empty pages or if we're at the calculated total
                    if (this.emptyPageCount >= 3 || page >= this.totalPages) {
                        debugLog(`[SCRAPE] Stopping after ${this.emptyPageCount} consecutive empty pages`);
                        break;
                    } else {
                        debugLog(`[SCRAPE] Empty page ${this.emptyPageCount}/3, continuing to next page`);
                        // Add delay before retry
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        continue;
                    }
                } else {
                    // Reset empty page counter when we find products
                    this.emptyPageCount = 0;
                }
            }
            
            // Extract EAN and Description if requested
            if ((this.options.extractEAN || this.options.extractDescription) && this.products.length > 0) {
                debugLog(`[SCRAPE] Starting EAN/Description extraction for ${this.products.length} products`);
                try {
                    await this.extractProductDetails();
                } catch (extractError) {
                    debugLog(`[SCRAPE] Error during EAN/Description extraction: ${extractError.message}`);
                    // Continue to save what we have
                }
            }
            
            // Save results even if extraction had errors
            const savedFiles = await this.saveResults();
            
            this.sendUpdate('complete', {
                totalProducts: this.products.length,
                duration: Date.now() - this.startTime,
                filename: this.extractSearchTerm(),
                files: savedFiles
            });
            
        } catch (error) {
            debugLog(`[SCRAPE] Fatal error: ${error.message}`);
            
            // Save whatever products we have collected so far
            if (this.products.length > 0) {
                debugLog(`[SCRAPE] Saving ${this.products.length} products before error cleanup`);
                try {
                    const savedFiles = await this.saveResults();
                    this.sendUpdate('complete', {
                        totalProducts: this.products.length,
                        duration: Date.now() - this.startTime,
                        filename: this.extractSearchTerm(),
                        files: savedFiles,
                        error: error.message
                    });
                } catch (saveError) {
                    debugLog(`[SCRAPE] Failed to save results: ${saveError.message}`);
                }
            }
            
            this.sendUpdate('error', {
                message: error.message,
                productsCollected: this.products.length
            });
        } finally {
            await this.cleanup();
        }
    }

    async saveResults() {
        const filename = this.extractSearchTerm();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        
        // Create results directory if doesn't exist
        await fs.mkdir('results', { recursive: true });
        
        // Save Excel only (no JSON as requested)
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
            xlsxFile
        });
        
        return { xlsxFile };
    }

    async cleanup() {
        this.isRunning = false;
        if (this.browser) {
            await this.browser.close();
        }
    }

    pause() {
        this.isPaused = true;
        this.sendUpdate('status', { status: 'paused' });
        debugLog(`[TASK ${this.id}] Paused`);
    }
    
    resume() {
        this.isPaused = false;
        this.sendUpdate('status', { status: 'resumed' });
        debugLog(`[TASK ${this.id}] Resumed`);
    }
    
    async waitIfPaused() {
        while (this.isPaused && this.isRunning) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    async handleRateLimit() {
        this.blockDetected = true;
        const waitTime = 60 + (this.retryCount * 30); // Increase wait time with each retry
        
        this.sendUpdate('rate_limited', {
            message: `Rate limit detected. Waiting ${waitTime} seconds before retrying...`,
            waitTime: waitTime,
            retryCount: this.retryCount
        });
        
        debugLog(`[RATE_LIMIT] Detected, waiting ${waitTime} seconds`);
        
        // Wait with progress updates
        for (let i = waitTime; i > 0 && this.isRunning && !this.isPaused; i--) {
            this.sendUpdate('waiting', {
                remainingTime: i,
                message: `Waiting to avoid blocking: ${i} seconds remaining...`
            });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        this.retryCount++;
        this.blockDetected = false;
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
    
    // Send active tasks to the newly connected client
    if (activeSessions.size > 0) {
        const activeTasks = Array.from(activeSessions.values()).map(task => task.getState());
        ws.send(JSON.stringify({
            type: 'active_tasks',
            tasks: activeTasks
        }));
    }
    
    ws.on('message', async (message) => {
        debugLog('[WS] Received message: ' + message);
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'start_multi':
                debugLog('[WS] Starting multi scraping with options: ' + JSON.stringify(data.options));
                // Parse multiple URLs
                const urls = data.urls.split('\n')
                    .map(url => url.trim())
                    .filter(url => url.length > 0 && (url.startsWith('http') || url.includes('ebay')));
                
                ws.send(JSON.stringify({
                    type: 'multi_start',
                    totalTasks: urls.length
                }));
                
                // Queue tasks instead of starting them all at once
                urls.forEach((url, index) => {
                    const taskId = `task_${Date.now()}_${index}`;
                    debugLog(`[WS] Creating task ${taskId} for URL: ${url}`);
                    const task = new ScraperTask(taskId, url, data.options, ws);
                    activeSessions.set(taskId, task);
                    
                    // Send task creation message to client
                    ws.send(JSON.stringify({
                        type: 'task_created',
                        taskId: taskId,
                        searchTerm: task.extractSearchTerm(),
                        url: url
                    }));
                    
                    // Add to queue instead of starting directly
                    debugLog(`[WS] Queueing task ${taskId}`);
                    task.sendUpdate('status', { status: 'queued', position: taskQueue.length + 1 });
                    taskQueue.push(task);
                });
                
                // Process the queue
                processTaskQueue();
                break;
                
            case 'reconnect':
                // Reassign WebSocket to existing tasks for this client
                activeSessions.forEach(task => {
                    task.setWebSocket(ws);
                    // Send current state
                    ws.send(JSON.stringify({
                        type: 'task_update',
                        taskId: task.id,
                        updateType: 'reconnected',
                        ...task.getState()
                    }));
                });
                break;
                
            case 'pause_task':
                const pauseTask = activeSessions.get(data.taskId);
                if (pauseTask) {
                    pauseTask.pause();
                }
                break;
                
            case 'resume_task':
                const resumeTask = activeSessions.get(data.taskId);
                if (resumeTask) {
                    resumeTask.resume();
                }
                break;
                
            case 'stop_task':
                const task = activeSessions.get(data.taskId);
                if (task) {
                    task.stop();
                    activeSessions.delete(data.taskId);
                    // Also remove from queue if present
                    const queueIndex = taskQueue.indexOf(task);
                    if (queueIndex > -1) {
                        taskQueue.splice(queueIndex, 1);
                        debugLog(`[STOP_TASK] Removed ${data.taskId} from queue`);
                    }
                }
                break;
                
            case 'stop_all':
                // Stop all running tasks
                activeSessions.forEach(task => task.stop());
                activeSessions.clear();
                // Clear the queue
                taskQueue.length = 0;
                activeBrowserCount = 0;
                debugLog('[STOP_ALL] Cleared all tasks and queue');
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