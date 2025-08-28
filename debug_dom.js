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

    const structure = await page.evaluate(() => {
        const item = document.querySelector('.srp-results li[id^="item"]');
        if (!item) return null;
        
        // Get all spans within the item
        const spans = item.querySelectorAll('span');
        const spanTexts = [];
        
        spans.forEach((span, i) => {
            const text = span.innerText || span.textContent;
            if (text && text.trim()) {
                spanTexts.push({
                    index: i,
                    text: text.trim(),
                    className: span.className
                });
            }
        });
        
        return {
            itemId: item.id,
            spanCount: spans.length,
            spans: spanTexts.slice(0, 20) // First 20 spans
        };
    });

    console.log('DOM Structure Analysis:');
    console.log(`Item ID: ${structure.itemId}`);
    console.log(`Total spans: ${structure.spanCount}`);
    console.log('\nSpan contents:');
    structure.spans.forEach(span => {
        console.log(`  [${span.index}] "${span.text}"`);
        if (span.className) {
            console.log(`       Class: ${span.className}`);
        }
    });

    await browser.close();
})();