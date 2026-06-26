'use strict';
'require view';
'require openclaw.api as api';
'require openclaw.ui as ocui';

return view.extend({
	load: function() { return Promise.all([ api.status(), api.gatewayToken() ]); },
	render: function(results) {
		ocui.applyTheme();
		var status = results[0].data || {}, token = results[1].data || {};
		var body;
		if (!status.gateway_running) {
			body = E('div', { 'class': 'oc-card-body' }, [
				E('span', { 'class': status.gateway_starting ? 'oc-badge oc-warn' : 'oc-badge oc-error' }, status.gateway_starting ? _('Gateway is starting') : _('Gateway not running'))
			]);
		} else {
			var url = 'http://' + window.location.hostname + ':' + status.port + '/';
			if (token.token) url += '#token=' + encodeURIComponent(token.token);
			body = E('div', { 'class': 'oc-card-body' }, [
				E('p', {}, [ E('a', { href: url, target: '_blank', rel: 'noopener' }, _('Open in new window')) ]),
				E('iframe', { 'class': 'oc-iframe', src: url, allowfullscreen: 'true' })
			]);
		}
		return E('div', {}, [
			E('link', { rel: 'stylesheet', href: L.resource('openclaw/openclaw.css') }),
			E('div', { 'class': 'oc-header' }, [ E('h2', {}, _('Web Console')), E('p', { 'class': 'oc-muted' }, _('Embeds the official OpenClaw admin interface.')) ]),
			E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-title' }, status.active_model ? _('Active model: %s').format(status.active_model) : _('OpenClaw Gateway')), body ])
		]);
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
