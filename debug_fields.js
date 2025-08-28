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
    const url = 'https://www.ebay.co.uk/sch/i.html?_nkw=blu+ray&_sacat=0&_from=R40&LH_PrefLoc=1&LH_ItemCondition=1000&LH_BIN=1&LH_FS=1&Format=DVD%7C4K%2520UHD%2520Blu%252Dray%7CBlu%252Dray%7CBlu%252Dray%25203D&rt=nc&Genre=Horror&_dcat=617';
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const fieldInfo = await page.evaluate(() => {
        const productElements = document.querySelectorAll('.srp-results li[id^="item"]');
        const results = [];
        
        // Check first 3 products
        for (let i = 0; i < Math.min(3, productElements.length); i++) {
            const item = productElements[i];
            const info = { index: i };
            
            // Try condition selectors
            const conditionSelectors = [
                '.SECONDARY_INFO',
                '.s-item__subtitle',
                'span[class*="condition"]',
                '.s-item__condition',
                'div[class*="condition"]',
                '[data-testid="item-condition"]'
            ];
            
            for (const selector of conditionSelectors) {
                const elem = item.querySelector(selector);
                if (elem) {
                    info[`condition_${selector}`] = elem.innerText || elem.textContent;
                }
            }
            
            // Try shipping selectors
            const shippingSelectors = [
                '.s-item__shipping',
                '.s-item__logisticsCost',
                '.fee',
                'span[class*="shipping"]',
                '.s-item__shipping-label',
                '[data-testid="item-shipping"]'
            ];
            
            for (const selector of shippingSelectors) {
                const elem = item.querySelector(selector);
                if (elem) {
                    info[`shipping_${selector}`] = elem.innerText || elem.textContent;
                }
            }
            
            // Find any text containing "Brand new" or "Free"
            const allText = item.innerText;
            if (allText.includes('Brand new')) {
                info.hasConditionInText = 'Brand new found';
            }
            if (allText.includes('Free') && allText.includes('postage')) {
                info.hasShippingInText = 'Free postage found';
            }
            
            results.push(info);
        }
        
        return results;
    });

    console.log('Field Analysis:');
    fieldInfo.forEach(item => {
        console.log(`\nProduct ${item.index}:`);
        Object.keys(item).forEach(key => {
            if (key !== 'index') {
                console.log(`  ${key}: "${item[key]}"`);
            }
        });
    });

    await browser.close();
})();