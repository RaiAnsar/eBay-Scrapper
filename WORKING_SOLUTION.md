# eBay Scraping - WORKING SOLUTION

## The Problem
- **Requests library gets blocked**: eBay returns "Service Unavailable - Zero size object" (378 bytes)
- **Headers alone don't work**: Even with complete Chrome headers, requests are blocked
- **BeautifulSoup can't parse**: Because it never receives the actual HTML
- **eBay requires JavaScript**: The site uses dynamic content loading

## The Solution: Playwright with Visible Browser

### Why Playwright Works
1. **Real browser engine**: Uses actual Chromium, not just HTTP requests
2. **JavaScript execution**: Can handle dynamic content
3. **Visible browser**: Less likely to be detected as a bot
4. **Human-like behavior**: Can simulate scrolling, delays, mouse movements

### Working Code: `practical_solution.py`

This scraper successfully:
- ✅ Opens a visible browser window
- ✅ Navigates to eBay search pages  
- ✅ Extracts product listings
- ✅ Handles pagination
- ✅ Attempts to extract EAN and descriptions
- ✅ Saves checkpoints for resuming
- ✅ Exports to Excel and CSV

### Key Features

1. **Anti-detection measures**:
   ```python
   browser = await p.chromium.launch(
       headless=False,  # VISIBLE BROWSER - key to avoiding detection
       args=['--disable-blink-features=AutomationControlled']
   )
   ```

2. **Human-like delays**:
   ```python
   await page.wait_for_timeout(random.randint(3000, 5000))
   ```

3. **Checkpoint system**:
   - Saves progress every 5 pages
   - Can resume from interruption
   - Stores seen items to avoid duplicates

4. **Resource-friendly**:
   - Single browser instance
   - Limited detail extraction (3 products per page)
   - Proper delays between requests

### Running the Scraper

```bash
python3 practical_solution.py
```

**What you'll see:**
1. A Chromium browser window opens
2. Navigates to eBay UK
3. Accepts cookies
4. Searches for products
5. Scrolls through pages
6. Extracts data
7. Saves results to Excel

### Output Files

- **Excel file**: `ebay_final_YYYYMMDD_HHMMSS.xlsx`
- **CSV backup**: `ebay_final_YYYYMMDD_HHMMSS.csv`
- **Checkpoint**: `scraping_checkpoint.json`

### Columns Extracted

1. **Title** ✅
2. **Price** ✅  
3. **Ebay_Item_Number** ✅
4. **EAN** ⚠️ (Limited success - many products don't have EAN visible)
5. **Description** ⚠️ (Requires loading individual product pages)
6. **Image_URL** ✅
7. **Condition** ✅
8. **Shipping** ✅
9. **URL** ✅
10. **Scraped_At** ✅

## Why Other Approaches Failed

### 1. Requests + BeautifulSoup
- **Status**: ❌ BLOCKED
- **Issue**: eBay detects and blocks non-browser requests
- **Response**: "Service Unavailable" (378 bytes)

### 2. Enhanced Headers
- **Status**: ❌ STILL BLOCKED
- **Issue**: Headers alone aren't enough
- **eBay checks**: JavaScript execution, browser fingerprinting

### 3. Turbo Scraper (10 parallel workers)
- **Status**: ❌ RESOURCE OVERLOAD
- **Issue**: Burned M4 Pro MacBook
- **Problem**: Too aggressive, triggered detection

## Recommendations

### For Small Scale (< 10,000 products)
Use `practical_solution.py` with:
- Visible browser
- 5-10 pages at a time
- Manual monitoring

### For Medium Scale (10,000 - 100,000 products)
1. Run in batches throughout the day
2. Use checkpoint system
3. Vary delays and patterns
4. Consider multiple IP addresses

### For Large Scale (740,000+ products)
Consider:
1. **eBay API**: Official but limited (5,000 requests/day)
2. **Professional service**: Octoparse, ScrapingBee, etc.
3. **Distributed scraping**: Multiple machines/IPs
4. **Incremental approach**: Build database over weeks

## Important Notes

### EAN Extraction Challenge
Many eBay listings don't display EAN in the HTML. It may be:
- In seller's description (unstructured)
- In images only
- Not provided at all
- Behind additional JavaScript loading

### Rate Limiting
- Scrape responsibly: 2-5 second delays
- Don't exceed 200 products per session without breaks
- Monitor for blocking indicators

### Legal Considerations
- Check eBay's Terms of Service
- Consider using official API for commercial use
- Respect robots.txt guidelines

## Troubleshooting

### "No products found"
- Check if browser window shows products
- Verify selectors haven't changed
- Increase wait times

### "Timeout errors"
- Reduce number of pages
- Increase delays
- Check internet connection

### "Browser crashes"
- Reduce memory usage
- Close other applications
- Restart script

## Summary

The **ONLY RELIABLE METHOD** for scraping eBay at scale is using a real browser automation tool like Playwright with:
- Visible browser window
- Human-like behavior
- Proper delays
- Checkpoint system
- Conservative extraction limits

The requests library and BeautifulSoup alone **WILL NOT WORK** due to eBay's anti-bot measures.