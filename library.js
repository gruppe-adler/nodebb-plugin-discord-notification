'use strict';

const user = require.main.require('./src/user');
const topics = require.main.require('./src/topics');
const categories = require.main.require('./src/categories');
const meta = require.main.require('./src/meta');
const nconf = require.main.require('nconf');
const routeHelpers = require.main.require('./src/routes/helpers');

const { WebhookClient, EmbedBuilder } = require('discord.js');

let hook = null;
const forumURL = nconf.get('url');

const plugin = module.exports;

plugin.config = {
	webhookURL: '',
	maxLength: '',
	postCategories: '',
	topicsOnly: '',
	messageContent: '',
};

plugin.regex = /https:\/\/discord(?:app)?\.com\/api\/webhooks\/([0-9]+?)\/(.+?)$/;

plugin.init = async function (params) {
	routeHelpers.setupAdminPageRoute(params.router, '/admin/plugins/discord-notification', function (req, res) {
		res.render('admin/plugins/discord-notification', {});
	});

	const settings = await meta.settings.get('discord-notification');
	for (const prop in plugin.config) {
		if (settings.hasOwnProperty(prop)) {
			plugin.config[prop] = settings[prop];
		}
	}

	// Parse Webhook URL (1: ID, 2: Token)
	const match = plugin.config.webhookURL.match(plugin.regex);

	if (match) {
		hook = new WebhookClient({ id: match[1], token: match[2] });
	}
};

plugin.postSave = async function (data) {
	try {
		const post = data.post;
		const topicsOnly = plugin.config.topicsOnly || 'off';

		if (topicsOnly === 'off' || (topicsOnly === 'on' && post.isMain)) {
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

			if (!postCategories || postCategories.indexOf(String(post.cid)) >= 0) {
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

				if (categoryData.bgColor) {
					embed.setColor(categoryData.bgColor);
				}

				const title = (categoryData.name || '') + ': ' + (topicData.title || '');
				embed.setTitle(title.substring(0, 256));

				if (content) {
					embed.setDescription(content.substring(0, 4096));
				}

				if (userData.username) {
					embed.setFooter({ text: userData.username, iconURL: thumbnail || undefined });
				}

				// Send notification:
				if (hook) {
					hook.send({ content: messageContent || undefined, embeds: [embed] }).catch(function (err) {
						console.error('[discord-notification] Error sending webhook:', err);
					});
				}
			}
		}
	} catch (err) {
		console.error('[discord-notification] Error in postSave:', err);
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
