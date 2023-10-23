import got from "got";
import HTMLParser from "node-html-parser";
import promptSync from "prompt-sync";
const prompt = promptSync();

import { Webhook, MessageBuilder } from "discord-webhook-node";
import { Channel, MessageEmbed } from "discord.js";
//https://www.amazon.com/Eluktronics-MAX-17-Processor-Graphics/dp/B097NRXCFR,  https://www.amazon.com/Pioneer-Photo-Albums-Magnetic-Self-Stick/dp/B003WSWFBY,  https://www.amazon.com/nVidia-Computing-Accelerator-Processing-Kepler/dp/B008X8Z95W;
//https://www.amazon.com/Newest-Sony-Playstation-Version-Console/dp/B09PMZ9JBJ


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
        'sec-ch-ua' : `"Chromium";v="118", "Google Chrome";v="118", "Not=A?Brand";v="99""`,
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
        // 'rtt': 200,      
        // 'ect': '4g', 
        // 'downlink': 10
    }
    const response = await got(productLink, {
        headers: myHeaders
    });
    // if(response && response.statusCode == 200) {
    //     let root = HTMLParser.parse(response.body);
    //     let title = root.getElementsByTagName('h1')[0].innerText;
    //     console.log("ID", title)
    //     let skuNumber = productLink.substring(productLink.indexOf('~/')+2, productLink.indexOf('.html'));
    //     console.log("SKU", skuNumber)
    //     if(root){
    //         let image = root.getElementsByTagName('img')[1].getAttribute('src');
    //         console.log(image)
    //         if(root.getElementsByTagName('h1')[0].innerText == 'The product you are trying to view is no longer available.') {    
    //             console.log(title + ": OUT OF STOCK");
    //         } else if (title = root.getElementsByTagName('h1')[0].innerText){
    //              let price =  root.querySelector('#ProductDetails > div.ProductDetails-form__info > div.ProductDetails-form__text.flex.flex-between.flex-center-vertical > span > span').innerText;
    //             console.log("price", price)
    //             let availableSize = root.querySelector('#ProductDetails > div.ProductDetails-form__info > div:nth-child(3)').getElementsByTagName('aria-labelledby');
    //             console.log('size', availableSize)
    //             let size = root.getElementsByTagName('button')[0].innerText;
    //             console.log("Hi", size)
    //             let productName = root.querySelector('#pageTitle').getElementsByTagName('span')[0].innerText;
    //             console.log("ProductName", productName)
    //             const hook = new Webhook("https://discordapp.com/api/webhooks/939293326325186570/id1i6R_fgH5Ijh-OpC0Zw62OpawuYbNjYiuS9vNuGEN-vON2MgUeujvMsW2W8-wMfox-");
    //             const embed = new MessageBuilder()
    //                 .setAuthor("Footsites Monitor", "https://cdn.freebiesupply.com/logos/thumbs/2x/foot-locker-2-logo.png")
    //                 .setColor('#90ee90')
    //                 .setTimestamp()
    //                 .setThumbnail(image)
    //                 .addField('ProductLink' , productLink)
    //                 .addField('ProductName' ,productName, true)
    //                 .addField('Availability', 'IN STOCK', false)
    //                 .addField('SKU', skuNumber)
    //                 .addField('Price', price)
    //             hook.send(embed);
    //             console.log(title + ": IN STOCK");
    //         } 
    //     }   
    // }

    const browser = await puppeteer.launch({ headless: true, timeout: 0 });
    const page = await browser.newPage();

    try {
        await page.goto(productLink, { waitUntil: 'domcontentloaded' });

        const title = await page.$eval('h1', (element) => element.innerText);
        const skuNumber = productLink.match(/~\/(\d+)\.html/)[1];
        const image = await page.$eval('img:nth-child(2)', (img) => img.getAttribute('src'));
        const availabilityMessage = await page.$eval('h1', (element) => element.innerText);

        if (availabilityMessage === 'The product you are trying to view is no longer available.') {
            console.log(`${title}: OUT OF STOCK`);
        } else {
            const price = await page.$eval(
                '#ProductDetails > div.ProductDetails-form__info > div.ProductDetails-form__text.flex.flex-between.flex-center-vertical > span > span',
                (element) => element.innerText
            );
            const availableSize = await page.$$eval(
                '#ProductDetails > div.ProductDetails-form__info > div:nth-child(3) > span',
                (sizeElements) => sizeElements.map((size) => size.innerText)
            );
            const size = availableSize[0];
            const productName = await page.$eval('#pageTitle > span', (element) => element.innerText);

            console.log('Product Title:', title);
            console.log('SKU:', skuNumber);
            console.log('Image URL:', image);
            console.log('Product Availability:', availabilityMessage);
            console.log('Price:', price);
            console.log('Available Sizes:', availableSize);
            console.log('Selected Size:', size);
            console.log('Product Name:', productName);

            // Send a Discord webhook notification for an in-stock product
            const hook = new Webhook("https://discord.com/api/webhooks/939293326325186570/id1i6R_fgH5Ijh-OpC0Zw62OpawuYbNjYiuS9vNuGEN-vON2MgUeujvMsW2W8-wMfox-");
            const embed = new MessageBuilder()
                .setAuthor("Footsites Monitor", "https://cdn.freebiesupply.com/logos/thumbs/2x/foot-locker-2-logo.png")
                .setColor('#90ee90')
                .setTimestamp()
                .setThumbnail(image)
                .addField('ProductLink', productLink)
                .addField('ProductName', productName, true)
                .addField('Availability', 'IN STOCK', false)
                .addField('SKU', skuNumber)
                .addField('Price', price);

            hook.send(embed);
            console.log(`${title}: IN STOCK`);
        }
    } catch (err) {
        console.error(`Error while monitoring ${productLink}: ${err}`);
    } finally {
        await browser.close();
    }
    
    await new Promise(r => setTimeout(r,8000));
    Monitor(productLink);
    return false;
    //console.log(response.statusCode); 
}

async function Run() {
    var productLinks = prompt("Enter links to monitor (separate by coma): ");
    var productLinksArr = productLinks.split(',');
    for(var i = 0; i < productLinksArr.length; i++) {
        productLinksArr[i] = productLinksArr[i].trim();

    }
    //productLinksArr = newArray;
    console.log(productLinksArr);

    var monitors = []  //array of promises

    productLinksArr.forEach(link => {
        var p = new Promise((resolve, reject) => {
            resolve(Monitor(link));
        }).catch(err => console.log(err));

        monitors.push(p);
    });

    console.log('Now monitoring ' + productLinksArr.length + ' items');  
    await Promise.allSettled(monitors);
}

Run();

//https://www.footlocker.com/en/product/~/55088063.html, https://www.footlocker.com/product/~/W2288111.html, https://www.footlocker.com/product/~/D9335641.html, https://www.footlocker.com/product/~/BB550HG1.html, https://www.footlocker.com/en/product/~/12167571.html, https://www.footlocker.com/product/~/T80120FL.html 