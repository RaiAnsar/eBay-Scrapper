#!/usr/bin/env node

/**
 * Node.js eBay Scraper - Lightweight & Reliable
 * Handles complex filtered URLs with all parameters
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');
const xlsx = require('xlsx');

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

class NodeEbayScraper {
    constructor(options = {}) {
        this.headless = options.headless !== false;
        this.slowMo = options.slowMo || 50; // Slow down actions
        this.browser = null;
        this.page = null;
        this.allProducts = [];
        this.seenItems = new Set();
    }

    async init() {
        console.log('🚀 Initializing browser...');
        
        this.browser = await puppeteer.launch({
            headless: this.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--window-size=1920,1080'
            ],
            slowMo: this.slowMo
        });
        
        this.page = await this.browser.newPage();
        
        // Set viewport
        await this.page.setViewport({ width: 1920, height: 1080 });
        
        // Set user agent
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Block images and styles to save bandwidth
        await this.page.setRequestInterception(true);
        this.page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        console.log('✅ Browser ready!\n');
    }

    async extractProductsFromPage() {
        // Wait for products to load
        try {
            await this.page.waitForSelector('.srp-results li[id^="item"], li[data-viewport], .s-item, div[data-view]', { timeout: 10000 });
        } catch (e) {
            console.log('⚠️  No products found on this page (waitForSelector failed)');
            // Still try to extract in case selectors loaded differently
        }

        // Extract products using browser context
        const products = await this.page.evaluate(() => {
            const items = [];
            
            // Try multiple selectors for different eBay layouts
            // Start with the most specific selector for search results
            let productElements = document.querySelectorAll('.srp-results li[id^="item"]');
            
            if (productElements.length === 0) {
                productElements = document.querySelectorAll('li[data-viewport]');
            }
            
            if (productElements.length === 0) {
                productElements = document.querySelectorAll('.s-item');
            }
            
            if (productElements.length === 0) {
                productElements = document.querySelectorAll('div[class*="s-item"]');
            }
            
            console.log(`Found ${productElements.length} potential products`);
            
            productElements.forEach((item, index) => {
                try {
                    // Skip sponsored items and headers
                    const itemText = item.innerText || '';
                    if (itemText.includes('SPONSORED') || 
                        itemText.includes('Results matching fewer words')) {
                        return;
                    }
                    
                    // Optional: Skip international sellers (currently disabled to get results)
                    // if (itemText.includes('from Germany') || 
                    //     itemText.includes('from Japan') || 
                    //     itemText.includes('from Malaysia') ||
                    //     itemText.includes('from Austria') ||
                    //     itemText.includes('international postage') ||
                    //     itemText.includes('Free international')) {
                    //     return;
                    // }
                    
                    // Get item link and ID
                    const linkElem = item.querySelector('a[href*="/itm/"]');
                    if (!linkElem) return;
                    
                    const href = linkElem.href;
                    const itemMatch = href.match(/\/itm\/(\d+)/);
                    if (!itemMatch) return;
                    
                    const itemNumber = itemMatch[1];
                    
                    // Get title - try multiple selectors
                    let title = '';
                    const titleSelectors = [
                        'a[href*="/itm/"] span',  // Most reliable for search results
                        '.s-item__link span',
                        'h3.s-item__title',
                        'h3',
                        '.s-item__title',
                        'span[role="heading"]',
                        '.vip'
                    ];
                    
                    for (const selector of titleSelectors) {
                        const elem = item.querySelector(selector);
                        if (elem && elem.innerText) {
                            title = elem.innerText.trim();
                            break;
                        }
                    }
                    
                    if (!title) return;
                    
                    // Get price
                    let price = '';
                    const priceSelectors = [
                        'span[class*="price"]',  // Works for international results
                        '.s-item__price',
                        'span.s-item__price',
                        '.lvprice',
                        '.bold'
                    ];
                    
                    for (const selector of priceSelectors) {
                        const elem = item.querySelector(selector);
                        if (elem && elem.innerText && elem.innerText.includes('£')) {
                            price = elem.innerText.trim();
                            break;
                        }
                    }
                    
                    // Get condition - look for specific patterns
                    let condition = '';
                    const spans = item.querySelectorAll('span');
                    for (const span of spans) {
                        const text = (span.innerText || span.textContent || '').trim();
                        if (text === 'Brand new' || text === 'Used' || text === 'Like new' || 
                            text === 'Very good' || text === 'Good' || text === 'Acceptable') {
                            condition = text;
                            break;
                        }
                    }
                    
                    // Get shipping - look for postage/shipping text
                    let shipping = '';
                    for (const span of spans) {
                        const text = (span.innerText || span.textContent || '').trim();
                        if ((text.includes('postage') || text.includes('shipping')) && 
                            !text.includes('from') && text.length < 50) {
                            shipping = text;
                            break;
                        }
                    }
                    
                    // Get images
                    const images = [];
                    const imgElems = item.querySelectorAll('img[src*="ebayimg"], img[data-src*="ebayimg"]');
                    imgElems.forEach((img, idx) => {
                        if (idx < 4) {
                            const src = img.src || img.dataset.src;
                            if (src && !src.includes('pixel')) {
                                // Convert to larger image
                                images.push(src.replace(/s-l\d+/, 's-l500'));
                            }
                        }
                    });
                    
                    items.push({
                        Title: title,
                        Price: price,
                        Ebay_Item_Number: itemNumber,
                        Image_URL_1: images[0] || '',
                        Image_URL_2: images[1] || '',
                        Image_URL_3: images[2] || '',
                        Image_URL_4: images[3] || '',
                        Condition: condition,
                        Shipping: shipping,
                        URL: `https://www.ebay.co.uk/itm/${itemNumber}`
                    });
                    
                } catch (err) {
                    console.error('Error extracting item:', err);
                }
            });
            
            return items;
        });
        
        return products;
    }

    async extractEAN(productUrl) {
        try {
            const newPage = await this.browser.newPage();
            await newPage.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const ean = await newPage.evaluate(() => {
                const bodyText = document.body.innerText || '';
                const eanMatch = bodyText.match(/\bEAN[:\s]*(\d{13}|\d{8})\b/i);
                return eanMatch ? eanMatch[1] : '';
            });
            
            await newPage.close();
            return ean;
        } catch (error) {
            console.error(`Error extracting EAN: ${error.message}`);
            return '';
        }
    }

    async scrapeUrl(url, options = {}) {
        const maxPages = options.maxPages || 50;
        const extractEAN = options.extractEAN || false;
        const extractDesc = options.extractDesc || false;
        
        if (!this.browser) await this.init();
        
        console.log('📍 URL:', url);
        console.log(`📄 Max pages: ${maxPages}`);
        console.log(`🔧 Extract EAN: ${extractEAN}`);
        console.log(`📝 Extract Description: ${extractDesc}`);
        console.log('\n' + '='.repeat(70) + '\n');
        
        // Navigate to first page
        await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check for total results
        const totalResults = await this.page.evaluate(() => {
            const resultElem = document.querySelector('h1.srp-controls__count-heading');
            if (resultElem) {
                const match = resultElem.innerText.match(/([\d,]+)\s+results?/i);
                if (match) {
                    return parseInt(match[1].replace(/,/g, ''));
                }
            }
            return 0;
        });
        
        console.log(`📊 Total results found: ${totalResults.toLocaleString()}`);
        const estimatedPages = Math.ceil(totalResults / 60); // Assuming 60 per page default
        console.log(`📄 Estimated pages: ${estimatedPages}\n`);
        
        let currentPage = 1;
        let hasNextPage = true;
        
        while (hasNextPage && currentPage <= maxPages) {
            console.log(`\n📄 Page ${currentPage}/${maxPages}`);
            console.log('-'.repeat(40));
            
            // If not first page, navigate to it
            if (currentPage > 1) {
                const pageUrl = url.includes('?') 
                    ? `${url}&_pgn=${currentPage}`
                    : `${url}?_pgn=${currentPage}`;
                    
                await this.page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Extract products
            const products = await this.extractProductsFromPage();
            
            // Filter duplicates
            const newProducts = [];
            for (const product of products) {
                if (!this.seenItems.has(product.Ebay_Item_Number)) {
                    this.seenItems.add(product.Ebay_Item_Number);
                    
                    // Add timestamp
                    product.Scraped_At = new Date().toISOString().replace('T', ' ').slice(0, 19);
                    product.EAN = '';
                    product.Description = '';
                    
                    newProducts.push(product);
                }
            }
            
            console.log(`  ✅ Found ${products.length} products (${newProducts.length} new)`);
            
            // Extract EAN if requested (limit to first 5 per page)
            if (extractEAN && newProducts.length > 0) {
                const eanCount = Math.min(5, newProducts.length);
                console.log(`  🔍 Extracting EAN for ${eanCount} products...`);
                
                for (let i = 0; i < eanCount; i++) {
                    const ean = await this.extractEAN(newProducts[i].URL);
                    if (ean) {
                        newProducts[i].EAN = ean;
                        console.log(`    ✓ Product ${i + 1}: EAN = ${ean}`);
                    }
                }
            }
            
            this.allProducts.push(...newProducts);
            
            // Show sample products
            if (newProducts.length > 0) {
                console.log('\n  Sample products:');
                newProducts.slice(0, 2).forEach((p, i) => {
                    console.log(`    ${i + 1}. ${p.Title.substring(0, 60)}...`);
                    console.log(`       Price: ${p.Price} | Item: ${p.Ebay_Item_Number}`);
                });
            }
            
            // Check for next page
            hasNextPage = await this.page.evaluate(() => {
                const nextBtn = document.querySelector('a[aria-label*="next page"]');
                return nextBtn && !nextBtn.classList.contains('disabled');
            });
            
            if (!hasNextPage || products.length === 0) {
                console.log('\n  ℹ️ No more pages found');
                break;
            }
            
            currentPage++;
            
            // Delay between pages
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        return this.allProducts;
    }

    async saveResults(filename = 'ebay_results') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        
        // Save as JSON
        const jsonFile = `${filename}_${timestamp}.json`;
        await fs.writeFile(jsonFile, JSON.stringify(this.allProducts, null, 2));
        console.log(`\n📁 JSON saved: ${jsonFile}`);
        
        // Save as Excel
        const xlsxFile = `${filename}_${timestamp}.xlsx`;
        
        // Ensure all columns exist
        const requiredCols = [
            'Title', 'Price', 'Ebay_Item_Number', 'EAN', 'Description',
            'Image_URL_1', 'Image_URL_2', 'Image_URL_3', 'Image_URL_4',
            'Condition', 'Shipping', 'URL', 'Scraped_At'
        ];
        
        const formattedProducts = this.allProducts.map(p => {
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
        
        console.log(`📁 Excel saved: ${xlsxFile}`);
        
        return { json: jsonFile, excel: xlsxFile };
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('\n👋 Browser closed');
        }
    }

    // Helper method to handle complex filtered URLs
    async scrapeFilteredSearch(baseSearch, filters = {}) {
        // Build URL with filters
        let url = `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(baseSearch)}`;
        
        // Add filters
        if (filters.category) url += `&_sacat=${filters.category}`;
        if (filters.condition) url += `&LH_ItemCondition=${filters.condition}`;
        if (filters.buyItNow) url += '&LH_BIN=1';
        if (filters.freeShipping) url += '&LH_FS=1';
        if (filters.ukOnly) url += '&LH_PrefLoc=1';
        if (filters.format) url += `&Format=${encodeURIComponent(filters.format)}`;
        if (filters.genre) url += `&Genre=${encodeURIComponent(filters.genre)}`;
        if (filters.minPrice) url += `&_udlo=${filters.minPrice}`;
        if (filters.maxPrice) url += `&_udhi=${filters.maxPrice}`;
        if (filters.itemsPerPage) url += `&_ipg=${filters.itemsPerPage}`;
        
        return await this.scrapeUrl(url, filters);
    }
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const url = args[0] || 'https://www.ebay.co.uk/sch/i.html?_nkw=blu+ray&_sacat=0&_from=R40&LH_PrefLoc=1&LH_ItemCondition=1000&LH_BIN=1&LH_FS=1&Format=DVD%7C4K%2520UHD%2520Blu%252Dray%7CBlu%252Dray%7CBlu%252Dray%25203D&rt=nc&Genre=Horror&_dcat=617';
    const maxPages = parseInt(args[1]) || 10;
    const extractEAN = args[2] === 'true';
    
    (async () => {
        const scraper = new NodeEbayScraper({ 
            headless: true,
            slowMo: 50
        });
        
        try {
            console.log('\n🚀 Starting eBay Scraper (Node.js)\n');
            console.log('='.repeat(70));
            
            const products = await scraper.scrapeUrl(url, {
                maxPages: maxPages,
                extractEAN: extractEAN,
                extractDesc: false
            });
            
            console.log('\n' + '='.repeat(70));
            console.log('📊 FINAL RESULTS');
            console.log('='.repeat(70));
            console.log(`✅ Total products scraped: ${products.length}`);
            console.log(`🎯 Unique items: ${scraper.seenItems.size}`);
            
            if (products.length > 0) {
                await scraper.saveResults('ebay_node_results');
            }
            
        } catch (error) {
            console.error('❌ Scraping failed:', error);
        } finally {
            await scraper.close();
        }
    })();
}

module.exports = NodeEbayScraper;