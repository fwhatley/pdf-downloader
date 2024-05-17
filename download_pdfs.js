const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const url = require("url");
const cliProgress = require("cli-progress");

const downloadsDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}

const visitedUrls = new Set();
const pdfUrls = new Set();

const downloadFile = async (fileUrl, downloadPath) => {
  const writer = fs.createWriteStream(downloadPath);
  const response = await axios({
    url: fileUrl,
    method: "GET",
    responseType: "stream",
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
};

const crawlPage = async (pageUrl, baseUrl, progressBar, limit) => {
  if (visitedUrls.has(pageUrl)) return;
  visitedUrls.add(pageUrl);

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  try {
    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 60000 });
  } catch (error) {
    console.error(`Failed to load page: ${pageUrl}`, error);
    await browser.close();
    progressBar.update(1);
    progressBar.stop();
    return;
  }

  const html = await page.content();
  const $ = cheerio.load(html);

  $("a[href]").each((index, element) => {
    const href = $(element).attr("href");
    if (href) {
      let absoluteUrl;
      try {
        absoluteUrl = url.resolve(pageUrl, href);
      } catch (e) {
        console.error(`Failed to resolve URL: ${href} on page: ${pageUrl}`, e);
        return;
      }

      try {
        const urlObject = new URL(absoluteUrl);

        if (urlObject.origin === baseUrl.origin) {
          if (absoluteUrl.endsWith(".pdf")) {
            pdfUrls.add(absoluteUrl);
          } else if (!visitedUrls.has(absoluteUrl)) {
            limit(() => crawlPage(absoluteUrl, baseUrl, progressBar, limit));
          }
        }
      } catch (e) {
        console.error(`Invalid URL encountered: ${absoluteUrl}`, e);
      }
    }
  });

  await browser.close();
  progressBar.update(1);
  progressBar.stop();
};

const downloadPdfs = async (pdfUrls, downloadFolder) => {
  const downloadPromises = Array.from(pdfUrls).map((pdfUrl) => {
    const pdfPath = path.join(downloadFolder, path.basename(pdfUrl));
    console.log(`Downloading ${pdfUrl} to ${pdfPath}`);
    return downloadFile(pdfUrl, pdfPath);
  });

  await Promise.all(downloadPromises);
};

const main = async (startUrl) => {
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(10); // Limit concurrency to 10

  const baseUrl = new URL(startUrl);

  // Create a timestamped folder for downloads
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const downloadFolder = path.join(downloadsDir, timestamp);
  fs.mkdirSync(downloadFolder);

  // Initialize progress bars
  const progressBar = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format:
        "Progress [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} Pages",
    },
    cliProgress.Presets.shades_grey
  );

  const crawlPageWithProgress = (pageUrl) => {
    const bar = progressBar.create(1, 0); // Initial progress set to 0 out of 1
    return crawlPage(pageUrl, baseUrl, bar, limit);
  };

  await crawlPageWithProgress(startUrl);
  progressBar.stop();

  await downloadPdfs(pdfUrls, downloadFolder);
};

const startUrl = process.argv[2];
if (!startUrl) {
  console.log("Please provide a URL as a command-line argument");
  process.exit(1);
}

main(startUrl)
  .then(() => console.log("Download completed"))
  .catch((err) => console.error("An error occurred:", err));
