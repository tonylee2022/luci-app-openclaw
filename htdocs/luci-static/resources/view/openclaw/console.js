'use strict';
'require view';
'require openclaw.api as api';

return view.extend({
	load: function() { return Promise.all([ api.status(), api.gatewayToken() ]); },
	render: function(results) {
		var status = results[0].data || {}, token = results[1].data || {};
		var body;
		if (!status.gateway_running) {
			body = E('div', { 'class': 'oc-card-body' }, [
				E('span', { 'class': status.gateway_starting ? 'oc-badge oc-warn' : 'oc-badge oc-error' }, status.gateway_starting ? _('网关正在启动') : _('网关未运行'))
			]);
		} else {
			var url = 'http://' + window.location.hostname + ':' + status.port + '/';
			if (token.token) url += '#token=' + encodeURIComponent(token.token);
			body = E('div', { 'class': 'oc-card-body' }, [
				E('p', {}, [ E('a', { href: url, target: '_blank', rel: 'noopener' }, _('在新窗口打开')) ]),
				E('iframe', { 'class': 'oc-iframe', src: url, allowfullscreen: 'true' })
			]);
		}
		return E('div', {}, [
			E('link', { rel: 'stylesheet', href: L.resource('openclaw/openclaw.css') }),
			E('div', { 'class': 'oc-header' }, [ E('h2', {}, _('Web 控制台')), E('p', { 'class': 'oc-muted' }, _('嵌入 OpenClaw 官方管理界面。')) ]),
			E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-title' }, status.active_model ? _('活跃模型：%s').format(status.active_model) : _('OpenClaw Gateway')), body ])
		]);
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
