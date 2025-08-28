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

    console.log('\nDEBUGGING EXTRACTION:');
    console.log('='.repeat(50));

    const debug = await page.evaluate(() => {
        const report = {
            selectors: {},
            firstItems: {}
        };

        // Test different selectors
        const testSelectors = [
            '.srp-results li[id^="item"]',
            'li[data-viewport]',
            '.s-item',
            'li.s-item',
            'div.s-item__wrapper',
            '.srp-results .s-item',
            '.srp-river-results .s-item'
        ];

        for (const selector of testSelectors) {
            const elements = document.querySelectorAll(selector);
            report.selectors[selector] = elements.length;
            
            if (elements.length > 0) {
                const first = elements[0];
                const link = first.querySelector('a[href*="/itm/"]');
                const titleElem = first.querySelector('h3, .s-item__title, span[role="heading"]');
                
                report.firstItems[selector] = {
                    hasLink: !!link,
                    linkHref: link ? link.href : null,
                    hasTitle: !!titleElem,
                    titleText: titleElem ? titleElem.innerText : null,
                    innerHTML: first.innerHTML.substring(0, 200)
                };
            }
        }

        // Check what the results count says
        const countElem = document.querySelector('h1.srp-controls__count-heading');
        report.resultsCount = countElem ? countElem.innerText : 'Not found';

        // Check if there's an error message
        const noResultsElem = document.querySelector('.srp-save-null-search__heading');
        report.noResultsMessage = noResultsElem ? noResultsElem.innerText : null;

        return report;
    });

    console.log('\nSelector Counts:');
    for (const [selector, count] of Object.entries(debug.selectors)) {
        console.log(`  ${selector}: ${count}`);
    }

    console.log('\nResults Count:', debug.resultsCount);
    
    if (debug.noResultsMessage) {
        console.log('No Results Message:', debug.noResultsMessage);
    }

    console.log('\nFirst Item Analysis:');
    for (const [selector, info] of Object.entries(debug.firstItems)) {
        console.log(`\n  ${selector}:`);
        console.log(`    Has Link: ${info.hasLink}`);
        console.log(`    Has Title: ${info.hasTitle}`);
        if (info.titleText) {
            console.log(`    Title: "${info.titleText}"`);
        }
    }

    await browser.close();
    console.log('\n✅ Debug complete!');
})();