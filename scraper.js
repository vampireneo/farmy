'use strict';
// This is a template for a Node.js scraper on morph.io (https://morph.io)
let cheerio = require('cheerio');
let request = require('request');
let sqlite3 = require('sqlite3').verbose();
let moment = require('moment');

let baseUrl = 'https://www.farmy.ch';
let numberOfParallelRequests = process.env.MORPH_PARALLELREQUESTS || 30;
let entryPages = [
	'/en/shop/baskets',
	'/en/shop/fruits-vegetables',
	'/en/shop/milk-products-eggs',
	'/en/shop/meat-fish',
	'/en/shop/bread-bakery',
	'/en/shop/pantry',
	'/en/shop/drinks',
	'/en/shop/muesli-sweets',
	'/en/shop/vegan'
];
let startTime = moment();

function initDatabase(callback) {
	// Set up sqlite database.
	const db = new sqlite3.Database('data.sqlite');
	db.serialize(function () {
		db.run('CREATE TABLE IF NOT EXISTS data (category TEXT, subCategory TEXT, productName TEXT, weight TEXT, currency TEXT, ' +
			'price REAL, producer TEXT, producedIn TEXT, certification TEXT, packaging TEXT, rating REAL, link TEXT, createDate TEXT)');
		callback(db);
	});
}

function updateRow(db, cat, subCat, name, weight, currency, price, producer, producedIn, certification, packaging, rating, link) {
	db.get('SELECT price FROM data where link = ? order by createDate desc limit 1', function (err, row) {
		if (!row || (row && row.price !== price)) {
			const statement = db.prepare("INSERT INTO data VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))");
			statement.run([cat, subCat, name, weight, currency, price, producer, producedIn, certification, packaging, rating, link]);
			statement.finalize();
		}
	});
}

function fetchPage(url, callback) {
	// Use request to read in pages.
	request(url, function (error, response, body) {
		if (error) {
			console.log('Error requesting page: ' + error);
			return;
		}
		callback(body);
	});
}

function run(db) {
	let totalTargets = 0;
	let entryPagesCounter = entryPages.length;
	let pagesWithProducts = [];
	let targetUrls = [];
	let completedTarget = 0;

	function getDataFromTargets() {
		let url = targetUrls.pop();
		if (url) {
			console.log(`Start get data from ${url}`);

			fetchPage(url, function (body) {
				let $ = cheerio.load(body);

				let category = $('#breadcrumbs li meta[content=2]').parent().find('span').text().trim();
				let subCategory = $('#breadcrumbs li meta[content=3]').parent().find('span').text().trim();
				let productName = $('meta[property="og:title"]').attr('content');
				let weight = $('.col-photo-gallery .property-weight .item-value').text().trim();
				let currency = $('meta[property="product:price:currency"]').attr('content');
				let price = parseFloat($('meta[property="product:price:amount"]').attr('content'));
				let link = $('link[rel=alternate][hreflang=en]').attr('href');
				let producer = $('meta[property="product:retailer_title"]').attr('content');
				let producedIn = $('.col-photo-gallery .property-produced_in .item-value').text().trim();
				let certification = $('.col-photo-gallery .property-quality .item-value').text().trim();
				let packaging = $('.col-photo-gallery .property-packaging .item-value').text().trim();
				let rating = parseFloat($('#productRating').val());

				updateRow(db, category, subCategory, productName, weight, currency, price, producer, producedIn, certification, packaging, rating, link);

				if (++completedTarget >= totalTargets) {
					console.log(`${completedTarget} jobs completed ${startTime.toNow()}.`);
					try {
						db.close();
					} catch (e) {
						// do nth
					}
				} else {
					getDataFromTargets();
				}
			});
		}
	}


	console.log(`entryPagesCounter: ${entryPagesCounter}`);
	entryPages.forEach(function (el) {
		console.log(`Start to fetch ${baseUrl}${el}`);
		fetchPage(`${baseUrl}${el}`, function (body) {
			let $ = cheerio.load(body);
			let products = parseInt($('#product-filter-top').text().trim().split(' ')[0], 10);
			let totalPages = Math.ceil(products / 30);
			for (let i = 1; i <= totalPages; i++) {
				pagesWithProducts.push(`${baseUrl}${el}?page=${i}`);
			}
			if (--entryPagesCounter <= 0) {
				let pagesWithProductsCounter = pagesWithProducts.length;
				console.log(`Start to fetch products from ${pagesWithProductsCounter} pages.`);

				while (pagesWithProducts.length > 0) {
					let url = pagesWithProducts.pop();
					console.log(`Start to fetch ${url}`);
					fetchPage(url, function (pageBody) {
						let $ = cheerio.load(pageBody);
						$('.product-link').each(function (i, ele) {
							targetUrls.push(`${baseUrl}${$(this).attr('href')}`);
							totalTargets++;
						});
						console.log(`totalTargets: ${totalTargets}`);
						if (--pagesWithProductsCounter <= 0) {
							console.log(`Start ${numberOfParallelRequests} getDataFromTargets functions`);
							for (let i = 0; i < numberOfParallelRequests; i++) {
								getDataFromTargets();
							}
						}
					});
				}
			}
		});
	});
}

initDatabase(run);
