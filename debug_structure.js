#!/usr/bin/env node

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    const url = 'https://www.ebay.co.uk/sch/i.html?_nkw=blu+ray&_sacat=0&_from=R40&LH_PrefLoc=1&LH_ItemCondition=1000&LH_BIN=1&LH_FS=1&Format=DVD%7C4K%2520UHD%2520Blu%252Dray%7CBlu%252Dray%7CBlu%252Dray%25203D&rt=nc&Genre=Horror&_dcat=617';
    
    console.log('Loading page...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('\nEXTRACTING PRODUCTS:');
    console.log('='.repeat(50));

    const products = await page.evaluate(() => {
        const items = [];
        
        // Use the selector that has 60 items
        const productElements = document.querySelectorAll('.srp-results li[id^="item"]');
        
        console.log(`Found ${productElements.length} product elements`);
        
        productElements.forEach((item, index) => {
            if (index >= 3) return; // Just check first 3
            
            const product = {
                index: index,
                id: item.id,
                classes: item.className
            };
            
            // Try different title selectors within this specific element
            const titleSelectors = [
                '.s-item__title',
                '.s-item__link span',
                'h3',
                'a[href*="/itm/"] span',
                '.s-item__info a',
                '[data-testid="item-title"]',
                '.s-item__link > span',
                'a.s-item__link span'
            ];
            
            for (const selector of titleSelectors) {
                const elem = item.querySelector(selector);
                if (elem && elem.innerText) {
                    product[`title_${selector}`] = elem.innerText.trim();
                }
            }
            
            // Get link
            const link = item.querySelector('a[href*="/itm/"]');
            product.hasLink = !!link;
            product.linkHref = link ? link.href : null;
            
            // Get price
            const priceElem = item.querySelector('.s-item__price');
            product.price = priceElem ? priceElem.innerText : null;
            
            // Check the HTML structure
            product.htmlSnippet = item.innerHTML.substring(0, 500);
            
            items.push(product);
        });
        
        return items;
    });

    console.log('\nProduct Analysis:');
    products.forEach(p => {
        console.log(`\nProduct ${p.index} (ID: ${p.id}):`);
        console.log(`  Has Link: ${p.hasLink}`);
        
        Object.keys(p).forEach(key => {
            if (key.startsWith('title_') && p[key]) {
                console.log(`  Title found with "${key.replace('title_', '')}": "${p[key]}"`);
            }
        });
        
        if (p.price) {
            console.log(`  Price: ${p.price}`);
        }
        
        // Show a snippet of HTML to understand structure
        if (p.htmlSnippet) {
            console.log(`  HTML snippet: ${p.htmlSnippet.substring(0, 200)}...`);
        }
    });

    await browser.close();
    console.log('\n✅ Structure analysis complete!');
})();