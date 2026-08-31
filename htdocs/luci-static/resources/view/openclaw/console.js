'use strict';
'require view';
'require dom';
'require poll';
'require openclaw.api as api';
'require openclaw.ui as ocui';

return view.extend({
	load: function() {
		return Promise.all([ api.status(), api.gatewayToken(), api.consoleDevicePairingList() ]);
	},

	formatPairingTime: function(value) {
		var n = +value;
		if (!isFinite(n) || n <= 0) return '';
		if (n < 100000000000) n *= 1000;
		try { return new Date(n).toLocaleString(); }
		catch (e) { return ''; }
	},

	renderPairings: function(result) {
		if (!this.pairingBody) return;
		var self = this, data = (result && result.data) || {}, pending = data.pending || [];
		if (!result || result.ok === false) {
			dom.content(this.pairingBody, E('p', { 'class': 'oc-badge oc-error' }, _((result && result.message) || 'Failed to query console device pairing requests')));
			return;
		}
		if (!pending.length) {
			dom.content(this.pairingBody, E('p', { 'class': 'oc-muted' }, _('No pending console devices. If the console asks for pairing, keep it open and click Refresh requests.')));
			return;
		}

		dom.content(this.pairingBody, pending.map(function(item) {
			var details = [];
			if (item.platform) details.push(_('Platform: %s').format(item.platform));
			if (item.client) details.push(_('Client: %s').format(item.client));
			if (item.origin) details.push(_('Origin: %s').format(item.origin));
			if (item.remote_ip) details.push(_('Source IP: %s').format(item.remote_ip));
			var requested = self.formatPairingTime(item.requested_at);
			if (requested) details.push(_('Requested: %s').format(requested));
			return E('div', { 'class': 'oc-card', 'style': 'margin:.5rem 0' }, [
				E('div', { 'class': 'oc-card-body' }, [
					E('div', { 'style': 'font-weight:600;margin-bottom:.35rem' }, item.name || _('Unknown device')),
					E('div', { 'class': 'oc-muted', 'style': 'word-break:break-word' }, details.length ? details.join(' · ') : _('Device details are unavailable.')),
					E('div', { 'style': 'margin-top:.55rem' }, [
						ocui.button(_('Approve'), 'cbi-button-action', function() { return self.handlePairing(item, 'approve'); }),
						' ',
						ocui.button(_('Reject'), 'cbi-button-negative', function() { return self.handlePairing(item, 'reject'); })
					])
				])
			]);
		}));
	},

	updatePairings: function() {
		var self = this;
		return api.consoleDevicePairingList().then(function(result) {
			self.renderPairings(result);
			return result;
		}).catch(function(err) {
			self.renderPairings({ ok: false, message: String((err && err.message) || err || _('Failed to query console device pairing requests')) });
		});
	},

	handlePairing: function(item, action) {
		var self = this, approving = action === 'approve';
		var question = approving
			? _('Approve console access for device "%s"?').format(item.name || _('Unknown device'))
			: _('Reject the pairing request from device "%s"?').format(item.name || _('Unknown device'));
		return ocui.confirm(question, {
			title: approving ? _('Approve console device') : _('Reject console device'),
			confirmLabel: approving ? _('Approve') : _('Reject'),
			danger: !approving
		}).then(function(ok) {
			if (!ok) return;
			ocui.setStatus(self.pairingStatus, 'running', approving ? _('Approving device...') : _('Rejecting device...'));
			var request = approving ? api.consoleDevicePairingApprove(item.request_id) : api.consoleDevicePairingReject(item.request_id);
			return request.then(function(result) {
				if (!result || result.ok === false) {
					ocui.setStatus(self.pairingStatus, 'error', _((result && result.message) || 'Device pairing operation failed'));
					return;
				}
				ocui.setStatus(self.pairingStatus, 'success', approving ? _('Device approved. Reconnecting the console...') : _('Device pairing request rejected.'));
				ocui.hideStatusLater(self.pairingStatus, 5000);
				return self.updatePairings().then(function() {
					if (approving && self.consoleFrame) self.consoleFrame.src = self.consoleFrame.src;
				});
			}).catch(function(err) {
				ocui.setStatus(self.pairingStatus, 'error', String((err && err.message) || err || _('Device pairing operation failed')));
			});
		});
	},

	render: function(results) {
		var self = this;
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
			openBtn = E('a', { 'class': 'cbi-button cbi-button-action', 'style': 'text-decoration:none', href: url, target: '_blank', rel: 'noopener' }, _('Open in new window'));
			this.consoleFrame = E('iframe', { 'class': 'oc-iframe', src: url, allowfullscreen: 'true' });
			body = E('div', { 'class': 'oc-card-body' }, [ this.consoleFrame ]);
		}
		var titleChildren = [ E('span', {}, titleText) ];
		if (openBtn) titleChildren.push(openBtn);

		this.pairingBody = E('div', { 'class': 'oc-card-body' });
		this.pairingStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.renderPairings(results[2]);
		var pairingCard = E('div', { 'class': 'oc-card' }, [
			E('div', { 'class': 'oc-card-title oc-card-title-row', 'style': 'display:flex;align-items:center;justify-content:space-between;gap:.5rem' }, [
				E('span', {}, _('Console device pairing')),
				ocui.button(_('Refresh requests'), '', function() { return self.updatePairings(); })
			]),
			this.pairingBody,
			this.pairingStatus
		]);

		this._pairingPoll = L.bind(this.updatePairings, this);
		poll.add(this._pairingPoll, 15);

		return E('div', {}, [
			ocui.cssLink(),
			E('div', { 'class': 'oc-header' }, [ E('h2', {}, _('Web Console')), E('p', { 'class': 'oc-muted' }, _('Embeds the official OpenClaw admin interface.')) ]),
			pairingCard,
			E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-title oc-card-title-row', 'style': 'display:flex;align-items:center;justify-content:space-between;gap:.5rem' }, titleChildren), body ])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
