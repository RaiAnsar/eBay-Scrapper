# 🛍️ eBay Advanced Scraper

A lightweight, high-performance eBay scraper with real-time progress tracking and concurrent processing capabilities. Built to handle large-scale product scraping without burning your hardware.

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![Puppeteer](https://img.shields.io/badge/Puppeteer-40B5A4?style=for-the-badge&logo=puppeteer&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=websocket&logoColor=white)

## ✨ Features

- 🚀 **Multi-URL Support** - Scrape multiple eBay searches simultaneously
- ⚡ **Concurrent Processing** - Handle multiple scraping tasks in parallel
- 📊 **Real-time Progress** - WebSocket-based live updates and statistics
- 🔍 **Optional EAN & Description** - Extract detailed product information when needed
- 🖼️ **Image Quality Control** - Choose between 500px, 800px, 1200px, or 1600px images
- 📁 **Multiple Export Formats** - Save as Excel (.xlsx) and JSON
- 🛡️ **Anti-Detection** - Built-in stealth mode to avoid blocking
- 🎯 **Smart Filtering** - Skip sponsored items, remove duplicates, UK sellers only
- 💾 **Background Operation** - Runs on server, continues even if you close your browser

## 📋 Prerequisites

- Node.js 16+ 
- Chrome/Chromium browser
- 2GB+ RAM recommended

## 🚀 Quick Start

### Local Installation

```bash
# Clone the repository
git clone https://github.com/RaiAnsar/eBay-Scrapper.git
cd eBay-Scrapper

# Install dependencies
npm install

# Start the server
node server_advanced.js

# Open browser
# Navigate to http://localhost:3001
```

### Production Deployment with PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js

# Monitor logs
pm2 logs ebay-scraper

# Check status
pm2 status
```

## 🎮 Usage

### Basic Scraping

1. **Enter eBay URLs** - Paste one or more eBay search URLs (one per line)
2. **Configure Options**:
   - **Max Pages**: Number of pages to scrape (0 = all pages)
   - **Items per Page**: 60, 120, or 240 items
   - **Image Quality**: 500px to 1600px
   - **Filters**: Skip sponsored, remove duplicates, UK only
   - **Extract Details**: Optional EAN and Description (slower)
3. **Start Scraping** - Click "Start All Tasks"
4. **Monitor Progress** - Watch real-time updates for each task
5. **Download Results** - Get Excel and JSON files when complete

### Example URLs

```
https://www.ebay.co.uk/sch/i.html?_nkw=blu+ray
https://www.ebay.co.uk/sch/i.html?_nkw=4k+uhd&_sacat=0&LH_BIN=1
https://www.ebay.co.uk/sch/i.html?_nkw=steelbook&LH_ItemCondition=1000
```

## 📊 Output Format

### Excel Columns
- **Title** - Product name
- **Price** - Current price
- **Ebay_Item_Number** - Unique eBay identifier
- **EAN** - European Article Number (optional)
- **Description** - Product description (optional, max 500 chars)
- **Image_URL_1-4** - Product images
- **Condition** - New/Used/Like New
- **Shipping** - Shipping information
- **URL** - Direct product link
- **Scraped_At** - Timestamp

### File Naming
Files are saved as: `{search_term}_{timestamp}.xlsx`

Example: `blu_ray_horror_2025-08-28-17-30-45.xlsx`

## ⚙️ Configuration

### Server Configuration (server_advanced.js)

```javascript
const PORT = 3001;  // Server port
const itemsPerPage = 60;  // Default items per page
const imageQuality = 800;  // Default image quality
```

### PM2 Configuration (ecosystem.config.js)

```javascript
module.exports = {
  apps: [{
    name: 'ebay-scraper',
    script: './server_advanced.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '2G'
  }]
}
```

## 🛠️ Advanced Features

### EAN & Description Extraction
When enabled, the scraper visits individual product pages to extract:
- **EAN/GTIN** from item specifics
- **Product Description** (limited to 500 characters)

⚠️ **Note**: This significantly increases scraping time (2-3x slower)

### Concurrent Task Management
- Each URL runs as an independent task
- Tasks can be stopped individually or all at once
- Progress tracked separately for each task
- Automatic retry on navigation timeouts

## 🚨 Troubleshooting

### 502 Bad Gateway
```bash
# Check if service is running
pm2 status

# Restart the service
pm2 restart ebay-scraper

# Check logs
pm2 logs ebay-scraper --lines 50
```

### Chrome Launch Errors
```bash
# Install Chrome dependencies (Ubuntu/Debian)
sudo apt-get install -y \
  chromium-browser \
  libatk-bridge2.0-0 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libxss1 \
  libasound2t64
```

### Port Already in Use
Change the port in `server_advanced.js`:
```javascript
const PORT = 3002;  // Or any available port
```

## 📈 Performance

- **Speed**: ~100-200 products/minute (without details)
- **Memory**: ~200-500MB per concurrent task
- **CPU**: Low usage with headless Chrome
- **Network**: Minimal bandwidth (images blocked during scraping)

## 🔒 Security & Ethics

- Respects robots.txt
- Includes delays between requests
- User-agent rotation
- No personal data collection
- Educational purposes only

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 👨‍💻 Author

**Rai Ansar**  
GitHub: [@RaiAnsar](https://github.com/RaiAnsar)

## 🙏 Acknowledgments

- Built with [Puppeteer](https://pptr.dev/)
- Stealth mode by [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
- Excel generation using [xlsx](https://www.npmjs.com/package/xlsx)

---

⭐ If you find this project useful, please consider giving it a star on GitHub!