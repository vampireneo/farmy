// This is a template for a Node.js scraper on morph.io (https://morph.io)

var cheerio = require("cheerio");
var request = require("request");
var sqlite3 = require("sqlite3").verbose();

var baseUrl = 'https://www.farmy.ch';

function initDatabase(callback) {
	// Set up sqlite database.
	var db = new sqlite3.Database("data.sqlite");
	db.serialize(function() {
		db.run('CREATE TABLE IF NOT EXISTS data (category TEXT, subCategory TEXT, productName TEXT, weight TEXT, price REAL, link TEXT, createDate TEXT)');
		db.run('CREATE TABLE IF NOT EXISTS target (url TEXT)');
		callback(db);
	});
}

function addTarget(db, link) {
	var statement = db.prepare("INSERT INTO target VALUES (?)");
	statement.run(link);
	statement.finalize();
}

function updateRow(db, cat, subCat, name, weight, price, link) {
	// Insert some data.
	var statement = db.prepare("INSERT INTO data VALUES (?, ?, ?, ?, ?, ?, datetime('now'))");
	statement.run([cat, subCat, name, weight, price, link]);
	statement.finalize();
}

function readRows(db) {
	// Read some data.
	db.each("SELECT rowid AS id, category, subCategory, productName, weight, price, link FROM data", function(err, row) {
		console.log(`${row.id}: ${row.productName}`);
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
	function getDataFromTargets() {
		db.serialize(function() {
			db.each('select url from target', function(err, row) {
				var url = row.url;

				var statement = db.prepare("DELETE FROM target WHERE url = ?");
				statement.run(row.url);
				statement.finalize();

				fetchPage(url, function(body) {
						var $ = cheerio.load(body);

						var category = $('#breadcrumbs li meta[content=2]').parent().find('span').text().trim();
						var subCategory = $('#breadcrumbs li meta[content=3]').parent().find('span').text().trim();
						var productName = $('meta[property="og:title"]').attr('content');
						var weight = $('.col-photo-gallery .property-weight .item-value').text().trim();
						var price = parseFloat($('meta[property="product:price:amount"]').attr('content'));
						var url = $('link[rel=alternate][hreflang=en]').attr('href');

						updateRow(db, category, subCategory, productName, weight, price, url);

						// readRows(db);
				});
			});

			// db.close();
		});
	}

	fetchPage(`${baseUrl}/en/shop/fruits-vegetables`, function(body) {
		var $ = cheerio.load(body);
		var targetUrls = [];
		$('.product-link').each(function(i, el) {
			addTarget(db, `${baseUrl}${$(this).attr('href')}`);
		});
		getDataFromTargets();
	});
}

initDatabase(run);
