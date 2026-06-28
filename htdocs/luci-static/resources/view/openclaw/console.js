'use strict';
'require view';
'require openclaw.api as api';
'require openclaw.ui as ocui';

return view.extend({
	load: function() { return Promise.all([ api.status(), api.gatewayToken() ]); },
	render: function(results) {
		ocui.applyTheme();
		var status = results[0].data || {}, token = results[1].data || {};
		var titleText = status.active_model ? _('Active model: %s').format(status.active_model) : _('OpenClaw Gateway');
		var body, openBtn = null;
		if (!status.gateway_running) {
			body = E('div', { 'class': 'oc-card-body' }, [
				E('span', { 'class': status.gateway_starting ? 'oc-badge oc-warn' : 'oc-badge oc-error' }, status.gateway_starting ? _('Gateway is starting') : _('Gateway not running'))
			]);
		} else {
			var url = 'http://' + window.location.hostname + ':' + status.port + '/';
			if (token.token) url += '#token=' + encodeURIComponent(token.token);
			// 「在新窗口打开」放到标题行最右, 用与操作按钮相同的蓝底白字样式 (cbi-button-action)。
			openBtn = E('a', { 'class': 'cbi-button cbi-button-action', 'style': 'text-decoration:none', href: url, target: '_blank', rel: 'noopener' }, _('Open in new window'));
			body = E('div', { 'class': 'oc-card-body' }, [
				E('iframe', { 'class': 'oc-iframe', src: url, allowfullscreen: 'true' })
			]);
		}
		var titleChildren = [ E('span', {}, titleText) ];
		if (openBtn) titleChildren.push(openBtn);
		return E('div', {}, [
			ocui.cssLink(),
			E('div', { 'class': 'oc-header' }, [ E('h2', {}, _('Web Console')), E('p', { 'class': 'oc-muted' }, _('Embeds the official OpenClaw admin interface.')) ]),
			E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-title oc-card-title-row', 'style': 'display:flex;align-items:center;justify-content:space-between;gap:.5rem' }, titleChildren), body ])
		]);
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
