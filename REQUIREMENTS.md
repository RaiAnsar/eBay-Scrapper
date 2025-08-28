# eBay Scraper Requirements Document
**Date**: August 28, 2025  
**Project**: eBay Product Data Extraction System

## Executive Summary
Need to replace Octoparse ($399/month) with a custom solution that can scrape eBay product data at scale, specifically handling 740,000+ Blu-ray products with complete product details including EAN codes and descriptions.

## Current Issues & Pain Points

### 1. Scale Problem
- **740,000+ products** available for "blu ray" search on eBay UK
- Current scrapers only getting 300-600 products before stopping
- eBay limits pagination to prevent mass scraping
- Need to handle ~12,000+ pages (at 60 items/page)

### 2. Data Extraction Failures
- **EAN extraction: 0% success rate** despite multiple attempts
- **Description extraction: 0% success rate** 
- Product pages timing out when accessed via automation
- Pages load "superfast" manually but timeout in scripts (bot detection)

### 3. Performance Issues
- Burning M4 Pro MacBook resources with parallel processing
- 10 parallel workers causing system overload without results
- Trade-off between speed and stability not optimized

### 4. Bot Detection
- eBay showing `/splashui/challenge` page for detected bots
- Product pages have stronger protection than search pages
- Headers and stealth techniques not bypassing detection
- `li[data-viewport]` selector works but product details blocked

## Functional Requirements

### Must Have
1. **Search Page Scraping**
   - Accept eBay search URLs directly (e.g., `https://www.ebay.co.uk/sch/i.html?_nkw=blu+ray`)
   - Handle pagination automatically
   - Extract from all available pages (not just 50)
   - Skip sponsored items and "Shop on eBay" placeholders

2. **Product Data Extraction**
   - Title ✅ (working)
   - Price ✅ (working)
   - eBay Item Number ✅ (working)
   - **EAN** ❌ (critical - must extract)
   - **Description** ❌ (critical - must extract clean text)
   - Image URLs (1-4) ✅ (partially working)
   - Condition ✅ (working)
   - Shipping info ✅ (working)
   - Product URL ✅ (working)

3. **Performance Metrics**
   - Track products scraped per minute
   - Show real-time progress
   - Handle 740,000+ products efficiently
   - Don't burn MacBook M4 Pro resources

4. **Data Processing**
   - Remove duplicates by Item Number
   - Clean descriptions (remove timestamps, shipping policies)
   - Export to Excel format
   - Save progress incrementally

### Nice to Have
1. Bulk URL processing (multiple searches)
2. Auto-detect total pages from result count
3. Resume from interruption
4. Schedule recurring scrapes

## Technical Specifications

### Current Implementation Details
- **Language**: Python 3.13
- **Framework**: FastAPI web interface
- **Browser Automation**: Playwright
- **Data Processing**: Pandas
- **Export Format**: Excel (.xlsx)
- **Web Interface**: http://localhost:8003

### Selectors That Work
```javascript
// Search page products
document.querySelectorAll('li[data-viewport]')  // 60+ items
document.querySelectorAll('.s-item')  // 2 items (headers)

// Product links
document.querySelectorAll('a[href*="/itm/"]')  // 124 links
```

### API Limitations (eBay Official)
- **Browse API**: 5,000 calls/day default limit
- **Finding API**: 5,000 calls/day default limit  
- **Total**: 5,000 for entire application (not per user)
- **Increase**: Requires "Application Growth Check" approval
- **Concurrent**: Max 18 simultaneous calls

## Solution Options Analysis

### Option 1: Official eBay API
**Pros:**
- Legal and approved method
- No bot detection issues
- Reliable data access

**Cons:**
- 5,000 requests/day limit (would need 148 days for 740k products)
- Requires approval for higher limits
- May not have all data fields (EAN, full descriptions)

### Option 2: Professional Scraping Service
**Services Available:**
- **Octoparse**: $399/month (current solution, working but expensive)
- **Oxylabs**: $149/month all-in-one access
- **ScrapingBee**: $29/month for 5,000 requests
- **ScrapeHero Cloud**: $5/month minimum

**Pros:**
- Handle bot detection professionally
- Rotating proxies and infrastructure
- Legal compliance handled

**Cons:**
- Monthly cost
- Data ownership concerns
- API integration required

### Option 3: Custom Solution with Infrastructure
**Requirements:**
- Rotating residential proxies
- Multiple browser profiles
- Session management
- Rate limiting (not parallel blasting)
- Headless detection bypass
- CAPTCHA solving service

**Estimated Components:**
- Proxy service: $100-500/month
- CAPTCHA solving: $50-100/month
- Cloud servers: $50-200/month
- Development time: 40-80 hours

### Option 4: Hybrid Approach
1. Use API for basic product data (5k/day)
2. Manual browser automation for EAN/descriptions
3. Incremental daily processing
4. Build database over time

## Recommended Solution

Given the requirements and constraints:

### Short-term (Immediate)
1. **Fix current scraper** to work with visible browser (non-headless)
2. **Reduce parallel workers** to 1-2 max
3. **Add proper delays** (2-5 seconds between requests)
4. **Focus on quality** over quantity (get EAN/descriptions working first)
5. **Scrape incrementally** (100-500 products per session)

### Medium-term (1-3 months)
1. **Implement proxy rotation** using residential proxies
2. **Add session management** to maintain cookies
3. **Implement CAPTCHA solving** service integration
4. **Build product database** incrementally
5. **Create resume/checkpoint** system

### Long-term (3-6 months)
1. **Apply for eBay API** higher limits
2. **Combine API + scraping** hybrid approach
3. **Consider professional service** if volume justifies cost
4. **Build distributed scraping** infrastructure

## Implementation Priority

1. **Fix EAN/Description extraction** (Critical)
   - Debug why product pages timeout
   - Implement better selectors
   - Add retry logic with delays

2. **Optimize performance** (High)
   - Reduce to 1-2 workers max
   - Add human-like delays
   - Show browser window

3. **Handle scale** (Medium)
   - Implement checkpoint/resume
   - Process in daily batches
   - Build incremental database

4. **Add infrastructure** (Low)
   - Proxy rotation
   - Session management
   - CAPTCHA solving

## Success Metrics

- [ ] Successfully extract EAN for >50% of products
- [ ] Successfully extract descriptions for >50% of products  
- [ ] Process 1,000 products per hour sustainably
- [ ] No MacBook overheating/resource issues
- [ ] Complete 740,000 products within 30 days
- [ ] Cost less than $399/month total

## Risk Assessment

### High Risk
- eBay legal action for TOS violation
- IP blocking/blacklisting
- Account suspension

### Medium Risk  
- Incomplete data extraction
- Performance degradation over time
- Detection algorithm updates

### Low Risk
- Data accuracy issues
- Export format problems
- UI/UX concerns

## Budget Comparison

| Solution | Monthly Cost | Products/Day | Days to Complete | Legal Risk |
|----------|-------------|--------------|------------------|------------|
| Current (Failed) | $0 | 0 | ∞ | High |
| Octoparse | $399 | Unlimited | 1-7 | Low |
| eBay API (default) | $0 | 5,000 | 148 | None |
| eBay API (approved) | $0 | 50,000+ | 15 | None |
| Oxylabs | $149 | ~100,000 | 7-10 | Medium |
| Custom + Proxies | $200-500 | ~20,000 | 37 | High |
| Hybrid (API+Custom) | $100 | 10,000 | 74 | Medium |

## Next Steps

1. **Immediate**: Test non-headless browser with single worker
2. **Today**: Implement proper delays and session management
3. **This Week**: Get EAN/Description extraction working for 100 products
4. **This Month**: Process first 10,000 products incrementally
5. **Long-term**: Evaluate professional service vs custom infrastructure

## Contact & Support

- **Developer**: Claude (AI Assistant)
- **Platform**: eBay UK (https://www.ebay.co.uk)
- **Target Search**: "blu ray" (~740,000 results)
- **Required Fields**: EAN, Description (currently failing)
- **Hardware**: MacBook M4 Pro (must not overheat)

---

*This document should be updated as new information becomes available or requirements change.*