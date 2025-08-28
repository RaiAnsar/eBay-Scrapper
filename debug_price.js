#!/usr/bin/env node

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    const url = 'https://www.ebay.co.uk/sch/i.html?_nkw=blu+ray&_sacat=0&_from=R40&LH_PrefLoc=1&LH_ItemCondition=1000&LH_BIN=1&LH_FS=1&Format=DVD%7C4K%2520UHD%2520Blu%252Dray%7CBlu%252Dray%7CBlu%252Dray%25203D&rt=nc&Genre=Horror&_dcat=617';
    
    console.log('Loading page...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const priceInfo = await page.evaluate(() => {
        const productElements = document.querySelectorAll('.srp-results li[id^="item"]');
        const results = [];
        
        // Check first 3 products
        for (let i = 0; i < Math.min(3, productElements.length); i++) {
            const item = productElements[i];
            const info = { index: i };
            
            // Try different price selectors
            const priceSelectors = [
                '.s-item__price',
                'span.s-item__price',
                '.lvprice',
                '.bold',
                'span[class*="price"]',
                '.s-item__detail--primary span',
                '.s-item__detail span',
                '[data-testid="item-price"]'
            ];
            
            for (const selector of priceSelectors) {
                const elem = item.querySelector(selector);
                if (elem) {
                    info[selector] = {
                        text: elem.innerText || elem.textContent,
                        className: elem.className
                    };
                }
            }
            
            // Get any span with £ symbol
            const allSpans = item.querySelectorAll('span');
            const priceSpans = [];
            allSpans.forEach(span => {
                const text = span.innerText || span.textContent || '';
                if (text.includes('£')) {
                    priceSpans.push({
                        text: text,
                        className: span.className
                    });
                }
            });
            info.priceSpans = priceSpans;
            
            results.push(info);
        }
        
        return results;
    });

    console.log('\nPrice Analysis:');
    priceInfo.forEach(item => {
        console.log(`\nProduct ${item.index}:`);
        Object.keys(item).forEach(key => {
            if (key !== 'index' && key !== 'priceSpans' && item[key]) {
                console.log(`  ${key}: "${item[key].text}"`);
            }
        });
        if (item.priceSpans && item.priceSpans.length > 0) {
            console.log('  Spans with £:');
            item.priceSpans.forEach(span => {
                console.log(`    "${span.text}" (class: ${span.className})`);
            });
        }
    });

    await browser.close();
})();