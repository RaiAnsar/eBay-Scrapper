# eBay Scraper Pro - Project Documentation

## Overview
High-performance eBay scraper with real-time progress tracking, anti-bot detection, and automated data extraction.

## Server Details
- **URL**: https://ebay.mediatronixs.com
- **Server IP**: 46.202.195.247
- **SSH Key**: `~/.ssh/vps`
- **Server Path**: `/var/www/ebay-scraper/`
- **Process Manager**: PM2 (process name: `ebay-scraper`)
- **Port**: 3001 (reverse proxied through Nginx)

## Key Features
- Real-time WebSocket communication for live progress updates
- Task queue system with MAX_CONCURRENT_BROWSERS = 1 to prevent crashes
- Bot detection handling with automatic 2-minute pause
- EAN and Description extraction from product pages
- XLSX export with formatted data
- Duplicate removal and sponsored item filtering
- UK-only filtering option

## Technical Architecture

### Core Components
1. **server_advanced.js** - Main server with ScraperTask class
2. **web_interface_minimal.html** - Modern UI with real-time updates
3. **results.html** - Download page for completed scrapes
4. **robots.txt** - Blocks all bots from indexing

### Key Technologies
- **Puppeteer** with stealth plugin for anti-detection
- **WebSocket** for bidirectional communication
- **Express.js** server
- **PM2** for process management
- **Nginx** with Let's Encrypt SSL

## Known Issues & Solutions

### EAN/Description Extraction
- **Primary selector**: `.item-description` for descriptions
- Creates separate browser page for each product to avoid frame detachment
- Fixed skip logic to check both EAN and Description independently

### eBay Limitations
- Hard limit of ~7,500 products per search query
- Rate limiting triggers bot detection after rapid scraping
- Automatic 2-minute pause when bot detection triggered

## Deployment Commands

### Deploy Changes
```bash
# Copy files to server (no Git on production)
scp -i ~/.ssh/vps server_advanced.js root@46.202.195.247:/var/www/ebay-scraper/
scp -i ~/.ssh/vps web_interface_minimal.html root@46.202.195.247:/var/www/ebay-scraper/

# Restart PM2 process
ssh -i ~/.ssh/vps root@46.202.195.247 "pm2 restart ebay-scraper"
```

### Monitor Server
```bash
# Check PM2 status
ssh -i ~/.ssh/vps root@46.202.195.247 "pm2 status"

# View logs
ssh -i ~/.ssh/vps root@46.202.195.247 "pm2 logs ebay-scraper --lines 50"

# Check debug log
ssh -i ~/.ssh/vps root@46.202.195.247 "tail -f /var/www/ebay-scraper/debug.log"
```

### Emergency Recovery
```bash
# If scraper crashes
ssh -i ~/.ssh/vps root@46.202.195.247 "pm2 restart ebay-scraper"

# If server runs out of memory
ssh -i ~/.ssh/vps root@46.202.195.247 "pm2 stop ebay-scraper && pm2 flush && pm2 start ebay-scraper"
```

## Configuration Options

### Scraping Options
- **Skip Sponsored**: Filters out sponsored listings
- **Remove Duplicates**: Removes duplicate products by ID
- **UK Only**: Filters for UK sellers only
- **Extract EAN**: Visits each product page to extract EAN
- **Extract Description**: Extracts product descriptions (max 500 chars)

### Performance Settings
- **Items Per Page**: 60/120/200 (affects speed vs. stability)
- **Max Pages**: 0 for all pages, or specific number
- **Concurrent Tasks**: 1-3 (1 recommended for stability)
- **Image Quality**: 500px-1600px

## UI Components

### Switch Styles
Beautiful gradient switches with:
- Smooth cubic-bezier animations
- Purple gradient when checked (#667eea to #764ba2)
- Hover effects with elevation
- Active state indicators

### Real-time Updates
- Progress bar with gradient fill
- Live statistics (products/sec, current page, etc.)
- Task status messages
- System log with timestamps

## Data Structure

### Product Fields
- Title
- Price
- URL
- Image
- Shipping
- Location
- Seller
- Watchers
- Sold
- TimeLeft
- Condition
- EAN (optional)
- Description (optional)

### Export Format
XLSX file with:
- All product fields as columns
- Formatted dates/times
- Clean numeric values for price/shipping
- Filename: `{search_term}_{timestamp}.xlsx`

## Recent Fixes (Aug 29, 2025)

1. **Fixed EAN/Description extraction logic**
   - Changed from OR to AND logic for checking existing data
   - Added `.item-description` as primary selector
   - Each product now uses separate browser page

2. **Improved UI switches**
   - Added proper CSS classes with animations
   - Fixed alignment issues
   - Implemented gradient backgrounds
   - Added hover and active states

3. **Task queue system**
   - Prevents concurrent browser crashes
   - Manages memory efficiently
   - Processes tasks sequentially

## Credits
Made with 💖 by [Rai Ansar](https://raiansar.com)