import got from "got";
import HTMLParser from "node-html-parser";
import promptSync from "prompt-sync";
const prompt = promptSync();
import puppeteer from "puppeteer";
import EventEmitter from "events";

import { Webhook, MessageBuilder } from "discord-webhook-node";

import express from "express";
import bodyParser from "body-parser";
  
// New app using express module
const app = express();
app.use(bodyParser.urlencoded({
    extended:true
}));

async function Monitor(productLink) {
    var myHeaders = {
        'connection' : 'keep-alive',
        'sec-ch-ua' : `"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99"`,
        'sec-ch-ua-mobile': '?0',
        'upgrade-insecure-requests': 1,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-user': '?1',
        'sec-fetch-dest': 'document',
        'Sec-Ch-Ua-Platform': `"macOS"`,        
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'en-US,en;q=0.9',
        'rtt': 200,      
        'ect': '4g', 
        'downlink': 10
    }
    const response = await got(productLink, {
        headers: myHeaders
    });
    const myEmitter = new EventEmitter();
    myEmitter.setMaxListeners(10);

    try {
        if (response && response.statusCode === 200) {
            const root = HTMLParser.parse(response.body);

            // Extract availability information
            const offerListingElement = root.querySelector('#offerListingID');
            const availabilityDiv = offerListingElement?.getAttribute('value');

            // Extract SKU information
            const asinElement = root.querySelector('#ASIN');
            const sku = asinElement?.getAttribute('value');

            // Extract product image URL and name
            const landingImageElement = root.querySelector('#landingImage');
            const titleElement = root.querySelector('#title');
            const productName = titleElement?.querySelector('span')?.innerText;

            // Log product information
            console.log('Availability Div:', availabilityDiv);
            console.log('SKU:', sku);
            console.log('Product Image URL:', landingImageElement?.getAttribute('src'));
            console.log('Product Name:', productName);

            // Check availability
            if (availabilityDiv === '') {
                console.log('OUT OF STOCK');
            } else {
                // Extract product price
                const priceElement = root.querySelector('.a-price .a-offscreen');
                // Extract Saving Percentage
                const savingsPercentage = root.querySelector('.a-size-large.a-color-price.savingPriceOverride.aok-align-center.reinventPriceSavingsPercentageMargin.savingsPercentage');
                if (priceElement && savingsPercentage) {
                    const price = priceElement.innerText;
                    const savings = savingsPercentage.innerText;
                    console.log('Price:', price);
                    console.log('Savings Percentage:', savingsPercentage);

                    // Create a Discord webhook and send a message
                    const hook = new Webhook('https://discord.com/api/webhooks/1165364956817002576/RIvWdsPAZ-fjuxIKPIG07emeznYuCHKLb0LW4pfdmtg5vc5H-n0RCh6jBZ-wdbuOundF');
                    const embed = new MessageBuilder()
                        .setAuthor('Amazon Monitor', 'https://upload.wikimedia.org/wikipedia/commons/d/de/Amazon_icon.png')
                        .setColor('#90ee90')
                        .setTimestamp()
                        .setThumbnail(landingImageElement?.getAttribute('src'))
                        .addField(productName || 'Product Name Not Found', productLink, true)
                        .addField('Availability', 'IN STOCK', false)
                        .addField('SKU', sku || 'SKU Not Found', true)
                        .addField('Offer ID', availabilityDiv)
                        .addField('Price', price)
                        .addField('Saving Percentage', savings);

                    await hook.send(embed);
                    console.log(productName + ': IN STOCK');
                } else {
                    console.log('Price element not found.');
                }
            }
        } else {
            console.log('Invalid response');
        }
    } catch (error) {
        console.error('Error while scraping:', error);
    }
    
    await new Promise(r => setTimeout(r,8000));
    Monitor(productLink);
    return false;
}

async function Run() {
    const productLinks = prompt("Enter links to monitor (separated by commas): ");
    const productLinksArr = productLinks.split(',').map(productLink => productLink.trim());

    console.log(productLinksArr);

    console.log(`Now monitoring ${productLinksArr.length} items`);

    const monitors = productLinksArr.map(link => Monitor(link));
    await Promise.allSettled(monitors);
}

Run();
