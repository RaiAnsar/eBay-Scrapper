#!/usr/bin/env node

/**
 * Lightweight eBay Scraper using Puppeteer
 * - Single browser instance
 * - Sequential page processing
 * - Minimal resource usage
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');

puppeteer.use(StealthPlugin());

class LightweightEbayScraper {
    constructor(options = {}) {
        this.headless = options.headless !== false;
        this.delay = options.delay || 2000; // Delay between pages
        this.browser = null;
        this.page = null;
    }

    async init() {
        this.browser = await puppeteer.launch({
            headless: this.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process', // Run in single process mode
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ],
            defaultViewport: { width: 1280, height: 720 }
        });
        
        this.page = await this.browser.newPage();
        
        // Block unnecessary resources
        await this.page.setRequestInterception(true);
        this.page.on('request', (req) => {
            if (req.resourceType() === 'image' || 
                req.resourceType() === 'media' ||
                req.resourceType() === 'font' ||
                req.resourceType() === 'stylesheet') {
                req.abort();
            } else {
                req.continue();
            }
        });
    }

    async scrapeEbaySearch(searchTerm, maxPages = 10) {
        if (!this.browser) await this.init();
        
        const allProducts = [];
        const baseUrl = `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(searchTerm)}&_ipg=200`;
        
        console.log(`Starting scrape for: ${searchTerm}`);
        
        for (let page = 1; page <= maxPages; page++) {
            const url = page === 1 ? baseUrl : `${baseUrl}&_pgn=${page}`;
            
            try {
                console.log(`Scraping page ${page}...`);
                await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                
                // Wait a bit for dynamic content
                await this.page.waitForTimeout(1000);
                
                // Extract products
                const products = await this.page.evaluate(() => {
                    const items = [];
                    const listings = document.querySelectorAll('li[data-viewport], div.s-item__wrapper');
                    
                    listings.forEach(item => {
                        // Skip "Shop on eBay" entries
                        if (item.textContent.includes('Shop on eBay')) return;
                        
                        const title = item.querySelector('.s-item__title')?.textContent || '';
                        const price = item.querySelector('.s-item__price')?.textContent || '';
                        const link = item.querySelector('.s-item__link')?.href || '';
                        const image = item.querySelector('.s-item__image img')?.src || '';
                        const condition = item.querySelector('.SECONDARY_INFO')?.textContent || '';
                        
                        if (title && price && link) {
                            items.push({
                                title: title.replace('New Listing', '').trim(),
                                price: price.trim(),
                                link: link,
                                image: image,
                                condition: condition.trim(),
                                ebay_id: link.match(/\/(\d+)\?/)?.[1] || ''
                            });
                        }
                    });
                    
                    return items;
                });
                
                console.log(`  Found ${products.length} products on page ${page}`);
                allProducts.push(...products);
                
                // Check if there's a next page
                const hasNextPage = await this.page.evaluate(() => {
                    return !!document.querySelector('a[aria-label*="next page"]');
                });
                
                if (!hasNextPage) {
                    console.log('No more pages found');
                    break;
                }
                
                // Delay before next page to avoid overload
                await this.page.waitForTimeout(this.delay);
                
            } catch (error) {
                console.error(`Error on page ${page}:`, error.message);
                break;
            }
        }
        
        return allProducts;
    }

    async extractEAN(productUrl) {
        if (!this.browser) await this.init();
        
        try {
            await this.page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.page.waitForTimeout(1000);
            
            const ean = await this.page.evaluate(() => {
                // Check item specifics table
                const rows = document.querySelectorAll('.ux-labels-values__labels');
                for (const row of rows) {
                    const text = row.textContent.toLowerCase();
                    if (text.includes('ean') || text.includes('upc') || text.includes('isbn')) {
                        const value = row.nextElementSibling?.textContent;
                        if (value && /^\d{8,13}$/.test(value.trim())) {
                            return value.trim();
                        }
                    }
                }
                
                // Check description for EAN patterns
                const description = document.querySelector('#desc_wrapper_ctr')?.textContent || '';
                const eanMatch = description.match(/\b(\d{13}|\d{12}|\d{8})\b/);
                if (eanMatch) return eanMatch[1];
                
                return null;
            });
            
            return ean;
        } catch (error) {
            console.error(`Error extracting EAN:`, error.message);
            return null;
        }
    }

    async scrapeWithEAN(searchTerm, maxPages = 5, eanBatchSize = 10) {
        const products = await this.scrapeEbaySearch(searchTerm, maxPages);
        
        console.log(`\nExtracting EANs for ${products.length} products...`);
        console.log('(Processing in small batches to avoid overload)');
        
        // Process EANs in small batches
        for (let i = 0; i < products.length && i < eanBatchSize; i++) {
            console.log(`Getting EAN ${i + 1}/${Math.min(products.length, eanBatchSize)}...`);
            const ean = await this.extractEAN(products[i].link);
            if (ean) {
                products[i].ean = ean;
                console.log(`  ✓ Found EAN: ${ean}`);
            }
            await this.page.waitForTimeout(1000); // Delay between EAN extractions
        }
        
        return products;
    }

    async saveToFile(products, filename = 'ebay_products.json') {
        await fs.writeFile(filename, JSON.stringify(products, null, 2));
        console.log(`Saved ${products.length} products to ${filename}`);
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

// CLI Usage
if (require.main === module) {
    const args = process.argv.slice(2);
    const searchTerm = args[0] || 'blu ray';
    const maxPages = parseInt(args[1]) || 5;
    const extractEAN = args[2] === 'true';
    
    (async () => {
        const scraper = new LightweightEbayScraper({ 
            headless: true,
            delay: 2000 // 2 second delay between pages
        });
        
        try {
            let products;
            
            if (extractEAN) {
                products = await scraper.scrapeWithEAN(searchTerm, maxPages, 20);
            } else {
                products = await scraper.scrapeEbaySearch(searchTerm, maxPages);
            }
            
            await scraper.saveToFile(products);
            
            console.log('\n✅ Scraping complete!');
            console.log(`Total products: ${products.length}`);
            
        } catch (error) {
            console.error('Scraping failed:', error);
        } finally {
            await scraper.close();
        }
    })();
}

module.exports = LightweightEbayScraper;