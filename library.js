'use strict';

const user = require.main.require('./src/user');
const topics = require.main.require('./src/topics');
const categories = require.main.require('./src/categories');
const meta = require.main.require('./src/meta');
const nconf = require.main.require('nconf');
const routeHelpers = require.main.require('./src/routes/helpers');
const winston = require.main.require('winston');

const { WebhookClient, EmbedBuilder } = require('discord.js');

let hook = null;
let lastWebhookURL = '';
const forumURL = nconf.get('url');

const plugin = module.exports;

plugin.config = {
	webhookURL: '',
	maxLength: '',
	postCategories: '',
	topicsOnly: '',
	messageContent: '',
};

/**
 * Normalize a CSS hex color to 6-digit format for discord.js compatibility.
 * Handles shorthand (#abc -> #aabbcc) and strips extra characters.
 */
function normalizeColor(color) {
	if (!color || typeof color !== 'string') {
		return null;
	}
	let hex = color.trim();
	if (!hex.startsWith('#')) {
		hex = '#' + hex;
	}
	// Handle shorthand hex (#abc -> #aabbcc)
	const shorthand = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
	const match = hex.match(shorthand);
	if (match) {
		hex = '#' + match[1] + match[1] + match[2] + match[2] + match[3] + match[3];
	}
	// Validate final format
	if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
		return hex;
	}
	return null;
}

/**
 * Load settings from the database and (re-)initialize the webhook client
 * if the webhook URL has changed. Settings are cached by NodeBB so this
 * is safe to call frequently without database overhead.
 */
async function reloadConfig() {
	const settings = await meta.settings.get('discord-notification');
	for (const prop in plugin.config) {
		if (settings.hasOwnProperty(prop)) {
			plugin.config[prop] = settings[prop];
		}
	}

	const webhookURL = (plugin.config.webhookURL || '').trim();

	// Only recreate the WebhookClient if the URL has changed
	if (webhookURL === lastWebhookURL) {
		return;
	}

	lastWebhookURL = webhookURL;
	hook = null;

	if (!webhookURL) {
		winston.info('[discord-notification] No webhook URL configured. Notifications disabled.');
		return;
	}

	// Try discord.js built-in URL parsing first (handles discord.com, ptb, canary)
	try {
		hook = new WebhookClient({ url: webhookURL });
		winston.info('[discord-notification] Webhook client initialized via URL.');
		return;
	} catch (e) {
		winston.verbose('[discord-notification] discord.js URL parsing failed: ' + e.message);
	}

	// Fallback: manual regex parsing (handles discordapp.com and other edge cases)
	const match = webhookURL.match(/https?:\/\/discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/([0-9]+)\/([A-Za-z0-9_-]{50,})/);
	if (match) {
		try {
			hook = new WebhookClient({ id: match[1], token: match[2] });
			winston.info('[discord-notification] Webhook client initialized via regex fallback.');
			return;
		} catch (e) {
			winston.error('[discord-notification] Failed to create WebhookClient: ' + e.message);
		}
	}

	winston.warn('[discord-notification] Invalid webhook URL. Notifications will not be sent.');
}

plugin.init = async function (params) {
	routeHelpers.setupAdminPageRoute(params.router, '/admin/plugins/discord-notification', function (req, res) {
		res.render('admin/plugins/discord-notification', {});
	});

	await reloadConfig();
};

plugin.postSave = async function (data) {
	try {
		// Reload settings (cached by NodeBB, so very fast) to pick up
		// any configuration changes made in the admin panel.
		await reloadConfig();

		const post = data.post;
		const topicsOnly = plugin.config.topicsOnly || 'off';

		if (!hook) {
			return;
		}

		if (topicsOnly === 'on' && !post.isMain) {
			return;
		}

		let content = post.content;

		const [userData, topicData, categoryData] = await Promise.all([
			user.getUserFields(post.uid, ['username', 'picture']),
			topics.getTopicFields(post.tid, ['title', 'slug']),
			categories.getCategoryFields(post.cid, ['name', 'bgColor']),
		]);

		let postCategories;
		try {
			postCategories = JSON.parse(plugin.config.postCategories);
		} catch (e) {
			postCategories = null;
		}

		// Empty array or null/undefined means "all categories"
		// Skip only if specific categories are configured and this post's category is not among them
		if (Array.isArray(postCategories) && postCategories.length > 0 && postCategories.indexOf(String(post.cid)) < 0) {
			return;
		}

		// Trim long posts:
		const maxQuoteLength = plugin.config.maxLength || 1024;
		if (content && content.length > maxQuoteLength) { content = content.substring(0, maxQuoteLength) + '...'; }

		// Ensure absolute thumbnail URL if an avatar exists:
		let thumbnail = null;

		if (userData.picture && userData.picture.match(/^\//)) {
			thumbnail = forumURL + userData.picture;
		} else if (userData.picture) {
			thumbnail = userData.picture;
		}

		// Add custom message:
		const messageContent = plugin.config.messageContent || '';

		// Make the rich embed:
		const embed = new EmbedBuilder()
			.setURL(forumURL + '/topic/' + topicData.slug)
			.setTimestamp();

		const color = normalizeColor(categoryData.bgColor);
		if (color) {
			embed.setColor(color);
		}

		let title = '';
		if (categoryData.name && topicData.title) {
			title = categoryData.name + ': ' + topicData.title;
		} else {
			title = categoryData.name || topicData.title || 'New Post';
		}
		embed.setTitle(title.substring(0, 256));

		if (content) {
			embed.setDescription(content.substring(0, 4096));
		}

		if (userData.username) {
			embed.setFooter({ text: userData.username, iconURL: thumbnail || undefined });
		}

		// Send notification:
		hook.send({ content: messageContent || undefined, embeds: [embed] }).catch(function (err) {
			winston.error('[discord-notification] Error sending webhook: ' + err.message);
		});
	} catch (err) {
		winston.error('[discord-notification] Error in postSave: ' + err.message);
		winston.error('[discord-notification] Stack: ' + err.stack);
	}
};

plugin.addAdminMenu = async function (header) {
	header.plugins.push({
		route: '/plugins/discord-notification',
		icon: 'fa-bell',
		name: 'Discord Notifications',
	});

	return header;
};
