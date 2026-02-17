'use strict';

define('admin/plugins/discord-notification', ['settings'], function (Settings) {
	const ACP = {};

	ACP.init = function () {
		socket.emit('admin.categories.getAll', function (err, data) {
			if (err || !data) {
				return;
			}
			var categories = data;
			for (var i = 0; i < categories.length; ++i) {
				$('#postCategories').append('<option value=' + categories[i].cid + '>' + categories[i].name + '</option>');
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
