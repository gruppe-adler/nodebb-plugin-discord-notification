'use strict';

define('admin/plugins/discord-notification', ['settings'], function (Settings) {
	const ACP = {};

	ACP.init = function () {
		socket.emit('admin.categories.getNames', function (err, data) {
			if (err || !data) {
				return;
			}
			const allCategories = data;
			for (let i = 0; i < allCategories.length; ++i) {
				$('#postCategories').append('<option value=' + allCategories[i].cid + '>' + allCategories[i].name + '</option>');
			}
		});

		Settings.load('discord-notification', $('.discord-notification-settings'));

		$('#save').on('click', function () {
			Settings.save('discord-notification', $('.discord-notification-settings'), function () {
				app.alert({
					type: 'success',
					alert_id: 'discord-notification-saved',
					title: 'Settings Saved',
					message: 'Please reload your NodeBB to apply these settings',
					clickfn: function () {
						socket.emit('admin.reload');
					},
				});
			});
		});
	};

	return ACP;
});
