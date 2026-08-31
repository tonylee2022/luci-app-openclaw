'use strict';
'require view';
'require poll';
'require ui';
'require dom';
'require openclaw.api as api';
'require openclaw.ui as ocui';

function severityClass(sev) {
	return sev === 'error' ? 'oc-error' : sev === 'warning' ? 'oc-warn' : 'oc-info';
}

function severityLabel(sev) {
	return sev === 'error' ? _('Error') : sev === 'warning' ? _('Warning') : _('Note');
}

return view.extend({
	load: function() {
		return Promise.all([ api.status(), api.gatewayToken() ]);
	},

	// ── 嵌入式终端: 按需拉起 ttyd 跑官方 configure 向导 (真实 PTY, 以 openclaw 运行) ──
	launchWizard: function(container, section) {
		dom.content(container, E('div', { 'class': 'oc-card-body' }, E('p', { 'class': 'oc-muted' }, _('Starting wizard terminal...'))));
		container.style.display = '';
		return api.wizardStart(section).then(L.bind(function(result) {
			if (!result.ok || !result.data || !result.data.port) {
				dom.content(container, E('div', { 'class': 'oc-card-body' }, E('p', { 'class': 'oc-badge oc-error' }, _(result.message || 'Wizard failed to start; make sure ttyd is installed (opkg install ttyd).'))));
				return;
			}
			var url = window.location.protocol + '//' + window.location.hostname + ':' + result.data.port + '/';
			dom.content(container, E('div', { 'class': 'oc-card-body' }, [
				E('p', { 'class': 'oc-muted' }, _('The official wizard terminal is open below: arrow keys to move, Space/Tab to select, Enter to confirm. When done, click Finish and restart gateway below to apply.')),
				E('iframe', { 'class': 'oc-iframe', src: url, allow: 'clipboard-read; clipboard-write', allowfullscreen: 'true' }),
				E('div', { 'class': 'oc-actions', 'style': 'margin-top:.6rem' }, [
					ocui.button(_('Restart gateway'), 'cbi-button-positive', L.bind(this.finishWizard, this, container)),
					ocui.button(_('Close'), '', L.bind(function() { api.wizardStop(); container.style.display = 'none'; }, this))
				])
			]));
			window.setTimeout(function() { container.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
		}, this));
	},

	// 重启网关后刷新已加载的配置派生数据(提供商/渠道), 使界面跟随重启后的最新配置,
	// 不必手动点各卡片的「刷新」。仅刷新已加载过的 tab, 避免触发未访问 tab 的请求。
	refreshLoadedData: function() {
		if (this._providerLoaded) this.refreshProviders();
		if (this._channelLoaded) { this.refreshChannels(true); this.refreshDmScopeLabel(); }
	},

	// 重启网关并就地显示完整进度(提交→重启中→就绪/失败/超时), 不必切到基本设置查看。
	restartGateway: function(statusEl, onDone) {
		var self = this;
		ocui.setStatus(statusEl, 'running', _('"Restart gateway" command submitted; restarting...'));
		return api.serviceAction('restart_gateway').then(function(r) {
			if (r && r.ok === false) { ocui.setStatus(statusEl, 'error', _(r.message || 'Restart failed')); return; }
			var start = Date.now(), to = 40000;
			return new Promise(function(resolve) {
				(function tick() {
					api.status().then(function(res) {
						var d = (res && res.data) || {};
						if (d.gateway_running === true) {
							ocui.setStatus(statusEl, 'success', _('Gateway is ready and running (port %s).').format(d.port || '-'));
							ocui.hideStatusLater(statusEl);
							self.refreshLoadedData();
							if (onDone) onDone(true);
							return resolve();
						}
						if (d.gateway_failed === true) {
							ocui.setStatus(statusEl, 'error', _('Gateway failed to start; check the Log to troubleshoot.'));
							if (onDone) onDone(false);
							return resolve();
						}
						if (Date.now() - start > to) {
							ocui.setStatus(statusEl, 'error', _('Restart timed out; the gateway was not ready in time. Refresh later to check.'));
							return resolve();
						}
						ocui.setStatus(statusEl, 'running', d.gateway_starting ? _('Gateway is starting, please wait...') : _('Gateway is restarting, please wait...'));
						window.setTimeout(tick, 1500);
					}).catch(function() { window.setTimeout(tick, 1500); });
				})();
			});
		});
	},

	finishWizard: function(container) {
		api.wizardStop();
		var status = E('div', { 'class': 'oc-action-status' });
		dom.content(container, E('div', { 'class': 'oc-card-body' }, [
			E('p', { 'class': 'oc-muted' }, _('Configuration saved.')),
			status
		]));
		return this.restartGateway(status);
	},

	// 在嵌入终端里以 openclaw 身份打开 openclaw-shell, 让用户直接敲 CLI 命令配置/交互。
	launchShell: function(container) {
		dom.content(container, E('div', { 'class': 'oc-card-body' }, E('p', { 'class': 'oc-muted' }, _('Starting openclaw-shell terminal...'))));
		container.style.display = '';
		return api.wizardStart('shell').then(L.bind(function(result) {
			if (!result.ok || !result.data || !result.data.port) {
				dom.content(container, E('div', { 'class': 'oc-card-body' }, E('p', { 'class': 'oc-badge oc-error' }, _(result.message || 'Terminal failed to start; make sure ttyd is installed (opkg install ttyd).'))));
				return;
			}
			var url = window.location.protocol + '//' + window.location.hostname + ':' + result.data.port + '/';
			var shStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
			dom.content(container, E('div', { 'class': 'oc-card-body' }, [
				E('p', { 'class': 'oc-muted' }, _('openclaw-shell is open (running as the openclaw user with the environment ready). Type CLI commands directly, e.g. openclaw configure, openclaw channels add --channel telegram --token <token>, openclaw models, openclaw doctor, etc. After configuration changes, click Restart gateway below to apply. Click Close when finished.')),
				E('iframe', { 'class': 'oc-iframe', src: url, allow: 'clipboard-read; clipboard-write', allowfullscreen: 'true' }),
				E('div', { 'class': 'oc-actions', 'style': 'margin-top:.6rem' }, [
					ocui.button(_('Restart gateway'), 'cbi-button-action', L.bind(function() { return this.restartGateway(shStatus); }, this)),
					ocui.button(_('Close'), '', L.bind(function() { api.wizardStop(); container.style.display = 'none'; }, this))
				]),
				shStatus
			]));
			window.setTimeout(function() { container.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
		}, this));
	},

	// ── 完整配置向导 ──
	renderWizardTab: function() {
		this.fullWizard = E('div', { 'class': 'oc-card', 'style': 'display:none' });
		this.shellTerm = E('div', { 'class': 'oc-card', 'style': 'display:none' });
		return E('div', {}, [
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('Official setup')),
				E('div', { 'class': 'oc-card-body' }, [
					E('p', { 'class': 'oc-muted' }, _('Run the full official OpenClaw configuration wizard in the embedded terminal (workspace, models, gateway, channels, skills, etc.) to interactively complete first-time or full setup.')),
					E('div', { 'class': 'oc-actions' }, [
						ocui.button(_('Official setup wizard'), 'cbi-button-positive', L.bind(function() { return this.launchWizard(this.fullWizard, 'full'); }, this)),
						ocui.button(_('openclaw-shell (CLI)'), 'cbi-button-action', L.bind(function() { return this.launchShell(this.shellTerm); }, this))
					]),
					E('p', { 'class': 'oc-muted', 'style': 'margin-top:.6rem' }, _('If the wizard is awkward to use, switch to openclaw-shell and type CLI commands directly (more reliable).'))
				])
			]),
			this.fullWizard,
			this.shellTerm
		]);
	},

	// ── 健康检查 ──
	renderHealthTab: function() {
		this.findingsBox = E('div', {}, E('p', { 'class': 'oc-muted' }, _('Click Run health check to start diagnosis.')));
		this.healthStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.fixState = E('div', { 'class': 'oc-task-state', 'style': 'display:none' });
		this.fixLog = E('pre', { 'class': 'oc-log', 'style': 'display:none' }, '');
		this.permState = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.secretsState = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.secretsBox = E('div', {});
		this.capabilityState = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.capabilityBox = E('div', {}, E('p', { 'class': 'oc-muted' }, _('Check after upgrading OpenClaw or plugins; capability changes require explicit confirmation.')));
		this.capabilityTaskState = E('div', { 'class': 'oc-task-state', 'style': 'display:none' });
		this.capabilityLog = E('pre', { 'class': 'oc-log', 'style': 'display:none' }, '');
		return E('div', {}, [
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('Health check and fix')),
				E('div', { 'class': 'oc-card-body' }, [
					E('div', { 'class': 'oc-actions' }, [
						ocui.button(_('Run health check'), 'cbi-button-action', L.bind(this.runLint, this)),
						ocui.button(_('One-click fix (doctor --fix)'), 'cbi-button-positive', L.bind(this.runFix, this))
					]),
					this.healthStatus,
					E('div', { 'class': 'oc-task-wrap' }, [ this.fixState, this.fixLog ]),
					this.findingsBox
				])
			]),
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('Plugin capability consent')),
				E('div', { 'class': 'oc-card-body' }, [
					E('p', { 'class': 'oc-muted' }, _('Only enabled plugins currently blocked by new capability declarations are listed. Nothing is installed or authorized until you review and confirm.')),
					E('div', { 'class': 'oc-actions' }, [
						ocui.button(_('Check capability consent'), 'cbi-button-action', L.bind(this.checkPluginCapabilities, this))
					]),
					this.capabilityState,
					this.capabilityBox,
					E('div', { 'class': 'oc-task-wrap' }, [ this.capabilityTaskState, this.capabilityLog ])
				])
			]),
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('File ownership')),
				E('div', { 'class': 'oc-card-body' }, [
					E('p', { 'class': 'oc-muted' }, _('OpenClaw runs as the openclaw user; root-owned leftover files in the install directory cause plugin updates to fail (EACCES). Check and fix ownership here in one click.')),
					E('div', { 'class': 'oc-actions' }, [
						ocui.button(_('Check ownership'), 'cbi-button-action', L.bind(this.runPermCheck, this)),
						ocui.button(_('Fix ownership'), 'cbi-button-positive', L.bind(this.runPermFix, this))
					]),
					this.permState
				])
			]),
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('Plaintext secret scan')),
				E('div', { 'class': 'oc-card-body' }, [
					E('p', { 'class': 'oc-muted' }, _('Scan for secrets stored in plaintext in openclaw.json and similar files. When OpenClaw backs up to a private git repo, plaintext is committed too. To migrate to SecretRef (references), run openclaw secrets configure in the OpenClaw terminal. The gateway token is injected by this app via environment variables and needs no migration.')),
					E('div', { 'class': 'oc-actions' }, [
						ocui.button(_('Scan plaintext secrets'), 'cbi-button-action', L.bind(this.runSecretsAudit, this))
					]),
					this.secretsState,
					this.secretsBox
				])
			])
		]);
	},

	runSecretsAudit: function() {
		var self = this;
		ocui.setStatus(this.secretsState, 'running', _('Scanning plaintext secrets...'));
		dom.content(this.secretsBox, '');
		return api.secretsAudit().then(function(r) {
			if (!r.ok) { ocui.setStatus(self.secretsState, 'error', _(r.message || 'Scan failed')); ocui.hideStatusLater(self.secretsState); return; }
			var d = r.data || {}, s = d.summary || {}, findings = d.findings || [];
			var plain = s.plaintext || 0;
			if (!findings.length) { ocui.setStatus(self.secretsState, 'success', _('No plaintext secrets found.')); ocui.hideStatusLater(self.secretsState); return; }
			if (plain > 0) ocui.setStatus(self.secretsState, 'warn', _('Found %s plaintext secrets; run openclaw secrets configure in the OpenClaw terminal to migrate.').format(plain));
			else ocui.setStatus(self.secretsState, 'success', _('No plaintext secrets (informational only).'));
			var rows = findings.map(function(f) {
				var sev = f.severity === 'warn' ? 'warning' : (f.severity || 'info');
				return E('div', { 'class': 'oc-finding' }, [
					E('span', { 'class': 'oc-badge ' + severityClass(sev) }, f.code || ''),
					E('div', { 'class': 'oc-finding-body' }, [
						E('div', { 'class': 'oc-finding-msg' }, f.message || ''),
						E('div', { 'class': 'oc-finding-id' }, (f.path || '') + (f.file ? '  ·  ' + f.file : ''))
					])
				]);
			});
			dom.content(self.secretsBox, rows);
		}).catch(function(e) { ocui.setStatus(self.secretsState, 'error', _(String(e && e.message || e))); });
	},

	runPermCheck: function() {
		var self = this;
		ocui.setStatus(this.permState, 'running', _('Checking file ownership...'));
		return api.permCheck().then(function(r) {
			if (!r.ok) { ocui.setStatus(self.permState, 'error', _(r.message || 'Check failed')); ocui.hideStatusLater(self.permState); return; }
			var d = r.data || {};
			if (!d.count) { ocui.setStatus(self.permState, 'success', _('File ownership is fine (all owned by openclaw).')); ocui.hideStatusLater(self.permState); return; }
			var eg = (d.samples || []).slice(0, 3).join('，');
			ocui.setStatus(self.permState, 'warn', _('Found %s files not owned by openclaw; click Fix ownership. Examples: %s').format(d.count, eg || '-'));
		}).catch(function(e) { ocui.setStatus(self.permState, 'error', _(String(e && e.message || e))); });
	},

	runPermFix: function() {
		var self = this;
		return ocui.runOp(this.permState, {
			running: _('Fixing file ownership...'),
			success: _('File ownership fixed.'),
			submit: function() { return api.permFix(); },
			onDone: function(ok) { if (ok) self.runPermCheck(); }
		});
	},

	renderFindings: function(result) {
		var d = result.data || {};
		var findings = d.findings || [];
		var summary = E('p', { 'class': 'oc-muted' }, _('Ran %s checks, found %s results.').format(d.checksRun || 0, findings.length));
		if (!findings.length) {
			dom.content(this.findingsBox, [ summary, E('p', { 'class': 'oc-badge oc-ok' }, _('All good, no issues found.')) ]);
			return;
		}
		var order = { error: 0, warning: 1, info: 2 };
		findings.sort(function(a, b) { return (order[a.severity] !== undefined ? order[a.severity] : 3) - (order[b.severity] !== undefined ? order[b.severity] : 3); });
		var rows = findings.map(function(f) {
			return E('div', { 'class': 'oc-finding' }, [
				E('span', { 'class': 'oc-badge ' + severityClass(f.severity) }, severityLabel(f.severity)),
				E('div', { 'class': 'oc-finding-body' }, [
					E('div', { 'class': 'oc-finding-msg' }, f.message || ''),
					f.fixHint ? E('div', { 'class': 'oc-finding-hint' }, f.fixHint) : '',
					E('div', { 'class': 'oc-finding-id' }, f.checkId + (f.path ? '  ·  ' + f.path : ''))
				])
			]);
		});
		dom.content(this.findingsBox, [ summary ].concat(rows));
	},

	resetHealthTab: function() {
		dom.content(this.findingsBox, E('p', { 'class': 'oc-muted' }, _('Click Run health check to start diagnosis.')));
		if (this.healthStatus) this.healthStatus.style.display = 'none';
		if (this.fixLog) this.fixLog.style.display = 'none';
		if (this.fixState) this.fixState.style.display = 'none';
	},

	runLint: function() {
		var self = this;
		dom.content(this.findingsBox, E('p', { 'class': 'oc-muted' }, _('Running health check, please wait...')));
		return ocui.runOp(this.healthStatus, {
			running: _('Running health check...'),
			success: _('Health check completed.'),
			submit: function() {
				return api.doctorLint().then(function(result) {
					if (result.ok) self.renderFindings(result);
					else dom.content(self.findingsBox, E('p', { 'class': 'oc-badge oc-error' }, _(result.message || 'Health check failed')));
					var b = E('button', { 'type': 'button', 'class': 'cbi-button', 'style': 'margin-top:.5rem' }, _('Close'));
					b.addEventListener('click', L.bind(self.resetHealthTab, self));
					self.findingsBox.appendChild(b);
					return result;
				});
			}
		});
	},

	runFix: function() {
		var self = this;
		function dismissFix() {
			self.fixLog.style.display = 'none';
			self.fixState.style.display = 'none';
		}
		return ocui.runOp(this.healthStatus, {
			running: _('Fix task running, please wait...'),
			success: _('Fix completed.'),
			submit: function() { return api.doctorFix(); },
			cancel: function() { return api.taskCancel('openclaw-doctor-fix'); },
			onClose: dismissFix,
			pollLog: function() { return api.doctorFixLog(); },
			onLog: function(d) {
				self.fixState.style.display = '';
				self.fixLog.style.display = '';
				ocui.setLog(self.fixLog, d.log || (d.running ? _('Fix in progress...') : _('No output yet')));
				if (d.done) {
					self.fixState.className = 'oc-task-state ' + (d.exit_code === 0 ? 'oc-task-success' : 'oc-task-error');
					self.fixState.textContent = d.exit_code === 0 ? _('Fix completed.') : _('Fix failed, exit code: %s').format(d.exit_code);
				} else {
					self.fixState.className = 'oc-task-state oc-task-running';
					self.fixState.textContent = _('Fix task running, please wait...');
				}
			},
			onDone: function() {
				var b = E('button', { 'type': 'button', 'class': 'cbi-button', 'style': 'margin-left:.6rem' }, _('Close'));
				b.addEventListener('click', dismissFix);
				self.fixState.appendChild(b);
			}
		});
	},

	formatPluginCapabilities: function(plugin) {
		var parts = (plugin.capabilities || []).map(function(cap) {
			var ids = (cap.ids || []).join(', ');
			return (cap.kind || _('Capability')) + (ids ? ': ' + ids : '');
		});
		return parts.length ? parts.join(' · ') : _('No capability details reported');
	},

	checkPluginCapabilities: function() {
		var self = this;
		ocui.setStatus(this.capabilityState, 'running', _('Checking plugin capability consent...'));
		return api.pluginCapabilityCheck().then(function(result) {
			if (!result.ok) {
				ocui.setStatus(self.capabilityState, 'error', _(result.message || 'Capability check failed'));
				return;
			}
			var pending = (result.data || {}).pending || [];
			self.pendingPluginCapabilities = pending;
			if (!pending.length) {
				ocui.setStatus(self.capabilityState, 'success', _('All enabled plugin capabilities are confirmed.'));
				dom.content(self.capabilityBox, '');
				ocui.hideStatusLater(self.capabilityState);
				return;
			}
			ocui.setStatus(self.capabilityState, 'warn', _('%s enabled plugins require capability confirmation.').format(pending.length));
			var rows = pending.map(function(plugin) {
				return E('div', { 'class': 'oc-finding' }, [
					E('span', { 'class': 'oc-badge oc-warn' }, plugin.id),
					E('div', { 'class': 'oc-finding-body' }, [
						E('div', { 'class': 'oc-finding-msg' }, (plugin.name || plugin.id) + (plugin.version ? ' ' + plugin.version : '')),
						E('div', { 'class': 'oc-finding-hint' }, self.formatPluginCapabilities(plugin))
					])
				]);
			});
			rows.push(E('div', { 'class': 'oc-actions', 'style': 'margin-top:.6rem' }, [
				ocui.button(_('Review and confirm selected plugins'), 'cbi-button-positive', L.bind(self.showPluginCapabilityConfirm, self))
			]));
			dom.content(self.capabilityBox, rows);
		}).catch(function(error) {
			ocui.setStatus(self.capabilityState, 'error', _(String(error && error.message || error)));
		});
	},

	showPluginCapabilityConfirm: function() {
		var self = this;
		var pending = this.pendingPluginCapabilities || [];
		if (!pending.length) return this.checkPluginCapabilities();
		var boxes = pending.map(function(plugin) {
			var cb = E('input', { 'type': 'checkbox', 'value': plugin.id });
			cb.checked = true;
			return E('label', { 'style': 'display:flex;align-items:flex-start;gap:.5rem;padding:.35rem 0' }, [
				cb,
				E('span', {}, [
					E('strong', {}, (plugin.name || plugin.id) + (plugin.version ? ' ' + plugin.version : '')),
					E('br'),
					E('span', { 'class': 'oc-muted' }, self.formatPluginCapabilities(plugin))
				])
			]);
		});
		var confirm = E('button', { 'class': 'cbi-button-positive btn', click: function() {
			var selected = boxes.map(function(label) {
				var cb = label.querySelector('input');
				return cb.checked ? cb.value : null;
			}).filter(Boolean);
			if (!selected.length) return;
			ui.hideModal();
			return self.runPluginCapabilityFix(selected);
		} }, _('Confirm capabilities and fix'));
		ui.showModal(_('Confirm plugin capabilities'), [
			E('p', { 'class': 'oc-muted' }, _('Confirming allows each selected plugin to use the capabilities shown below. The server checks the pending state again before applying.')),
			E('div', { 'style': 'max-height:20rem;overflow:auto;border:1px solid var(--oc-border,#ddd);border-radius:4px;padding:.4rem .6rem;margin:.4rem 0' }, boxes),
			E('div', { 'class': 'right' }, [ ocui.closeButton(_('Cancel')), confirm ])
		]);
	},

	runPluginCapabilityFix: function(ids) {
		var self = this;
		this.capabilityTaskState.style.display = '';
		this.capabilityLog.style.display = '';
		return ocui.runOp(this.capabilityState, {
			running: _('Confirming plugin capabilities...'),
			success: _('Plugin capabilities confirmed and applied.'),
			submit: function() { return api.pluginCapabilityAccept(ids.join(',')); },
			cancel: function() { return api.taskCancel('openclaw-plugin-capability'); },
			pollLog: function() { return api.pluginCapabilityLog(); },
			onClose: function() {
				self.capabilityTaskState.style.display = 'none';
				self.capabilityLog.style.display = 'none';
			},
			onLog: function(data) {
				self.capabilityTaskState.className = 'oc-task-state ' + (data.done ? (data.exit_code === 0 ? 'oc-task-success' : 'oc-task-error') : 'oc-task-running');
				self.capabilityTaskState.textContent = data.done ? (data.exit_code === 0 ? _('Capability confirmation completed.') : _('Capability confirmation failed, exit code: %s').format(data.exit_code)) : _('Capability confirmation is running...');
				ocui.setLog(self.capabilityLog, data.log || _('No output yet'));
			},
			onDone: function() { self.checkPluginCapabilities(); }
		});
	},

	// ── 提供商 ──
	renderProviderTab: function() {
		this.providerBox = E('div', {}, E('p', { 'class': 'oc-muted' }, _('Loading...')));
		this.providerWizard = E('div', { 'class': 'oc-card', 'style': 'display:none' });
		return E('div', {}, [
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('Models and providers')),
				E('div', { 'class': 'oc-card-body' }, [
					this.providerBox,
					E('div', { 'class': 'oc-actions' }, [
						ocui.button(_('Configure models/providers'), 'cbi-button-positive', L.bind(function() { return this.launchWizard(this.providerWizard, 'model'); }, this)),
						ocui.button(_('Set active model'), 'cbi-button-action', L.bind(this.showSetActiveModel, this)),
						ocui.button(_('Fallback models'), 'cbi-button-action', L.bind(this.showSetFallbacks, this)),
						ocui.button(_('Refresh'), '', L.bind(this.refreshProviders, this))
					])
				])
			]),
			this.providerWizard
		]);
	},

	refreshProviders: function() {
		return api.configSummary().then(L.bind(function(result) {
			var d = result.data || {};
			var items = [
				E('div', { 'class': 'oc-kv' }, [
					E('span', {}, _('Active model')), E('strong', {}, d.primary_model || _('Not configured')),
					E('span', {}, _('Fallback models')), E('span', {}, (d.fallback_models || []).length ? (d.fallback_models || []).join('、') : _('None')),
					E('span', {}, _('Gateway port')), E('span', {}, d.gateway_port || '-'),
					E('span', {}, _('Bind mode')), E('span', {}, d.gateway_bind || '-')
				])
			];
			items.push(E('div', { 'class': 'oc-section-label' }, _('Configured providers')));
			if ((d.providers || []).length) {
				items.push(E('table', { 'class': 'oc-table' }, [
					E('tr', {}, [ E('th', {}, _('Name')), E('th', {}, _('Authorize')), E('th', {}, _('Configured models')) ])
				].concat(d.providers.map(function(p) {
					return E('tr', {}, [
						E('td', {}, p.name),
						E('td', {}, p.auth || '-'),
						E('td', {}, '' + (p.model_count || 0))
					]);
				}))));
			} else {
				items.push(E('p', { 'class': 'oc-muted' }, _('No providers configured yet. Click the button below to configure with the official wizard.')));
			}
			dom.content(this.providerBox, items);
		}, this));
	},

	showSetActiveModel: function() {
		return api.configSummary().then(L.bind(function(result) {
			var d = result.data || {};
			// 只列「允许 ∩ 有授权」的模型: 在 agents.defaults.models 且其提供商有授权。
			var models = (d.allowed_models || []).filter(function(m) { return m.auth; });
			var status = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
			if (!models.length) {
				ui.showModal(_('Set active model'), [
					E('p', { 'class': 'oc-muted' }, _('No models available: configure models under Configure models/providers and complete provider authorization first.')),
					E('div', { 'class': 'right' }, [ ocui.closeButton(_('Close')) ])
				]);
				return;
			}
			var sel = E('select', { 'class': 'cbi-input-select', 'style': 'min-width:18rem' }, models.map(function(m) {
				var label = m.alias ? m.alias + ' (' + m.key + ')' : m.key;
				var attrs = { value: m.key };
				if (m.primary) attrs.selected = 'selected';
				return E('option', attrs, label);
			}));
			var doSet = L.bind(function() {
				return ocui.runOp(status, {
					running: _('Setting active model...'),
					success: _('Active model set; applying.'),
					submit: function() { return api.modelSet(sel.value); },
					onDone: L.bind(function(ok) {
						// 仅改写 primary, 网关自动热重载生效, 无需重启网关(避免断会话与阻塞)。
						this.refreshProviders();
					}, this)
				});
			}, this);
			ui.showModal(_('Set active model'), [
				E('p', { 'class': 'oc-muted' }, _('Choose the active (default) model among configured and authorized models; the gateway hot-reloads after saving.')),
				E('div', { 'class': 'oc-field' }, [ E('span', {}, _('Active model')), sel ]),
				status,
				E('div', { 'class': 'right' }, [
					ocui.closeButton(_('Close')),
					ocui.button(_('Save'), 'cbi-button-positive', doSet)
				])
			]);
		}, this));
	},

	// 直接管理 agents.defaults.model.fallbacks：勾选要保留的回退模型、一键清空。
	// 绕开官方 configure 向导(其 allowlist 默认勾上已配置模型,会把非 primary 全堆进 fallback)。
	showSetFallbacks: function() {
		return api.configSummary().then(L.bind(function(result) {
			var d = result.data || {};
			var primary = d.primary_model || '';
			var current = {};
			(d.fallback_models || []).forEach(function(k) { current[k] = true; });
			// 候选：已授权且非 primary 的模型；并入当前已配置的 fallback(即使其 provider 已无授权也要能取消)。
			var seen = {}, cands = [];
			(d.allowed_models || []).forEach(function(m) {
				if (m.auth && m.key !== primary && !seen[m.key]) { seen[m.key] = true; cands.push({ key: m.key, alias: m.alias }); }
			});
			(d.fallback_models || []).forEach(function(k) {
				if (k !== primary && !seen[k]) { seen[k] = true; cands.push({ key: k, alias: '' }); }
			});
			var status = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
			if (!cands.length) {
				ui.showModal(_('Fallback models'), [
					E('p', { 'class': 'oc-muted' }, _('No models available as fallbacks: configure and authorize multiple models under Configure models/providers first (a fallback cannot be the current active model).')),
					E('div', { 'class': 'right' }, [ ocui.closeButton(_('Close')) ])
				]);
				return;
			}
			var boxes = cands.map(function(m) {
				var cb = E('input', { 'type': 'checkbox', 'value': m.key });
				if (current[m.key]) cb.checked = true;
				var label = m.alias ? m.alias + ' (' + m.key + ')' : m.key;
				return E('label', { 'style': 'display:flex;align-items:center;gap:.4rem;padding:.15rem 0' }, [ cb, E('span', {}, label) ]);
			});
			var pick = function() { return boxes.map(function(l) { var cb = l.querySelector('input'); return cb.checked ? cb.value : null; }).filter(Boolean); };
			var save = L.bind(function() {
				return ocui.runOp(status, {
					running: _('Saving fallback models...'),
					success: _('Fallback models saved; applying.'),
					submit: function() { return api.modelFallbacksSet(pick().join(',')); },
					onDone: L.bind(function(ok) { this.refreshProviders(); }, this)
				});
			}, this);
			ui.showModal(_('Fallback models'), [
				E('p', { 'class': 'oc-muted' }, _('Select fallback models tried in order when the active model is unavailable; uncheck all to clear. The gateway hot-reloads after saving. Current active model: %s').format(primary || _('Not configured'))),
				E('div', { 'style': 'max-height:16rem;overflow:auto;border:1px solid var(--oc-border,#ddd);border-radius:4px;padding:.4rem .6rem;margin:.4rem 0' }, boxes),
				status,
				E('div', { 'class': 'right' }, [
					ocui.closeButton(_('Close')),
					ocui.button(_('Cancel all'), '', function() { boxes.forEach(function(l) { l.querySelector('input').checked = false; }); }),
					ocui.button(_('Save'), 'cbi-button-positive', save)
				])
			]);
		}, this));
	},

	// ── 渠道 ──
	renderChannelTab: function() {
		this.channelBox = E('div', {}, E('p', { 'class': 'oc-muted' }, _('Loading...')));
		this.channelWizard = E('div', { 'class': 'oc-card', 'style': 'display:none' });
		// 微信子卡的状态元素
		this.wxPlugin = E('span', {}, '-');
		this.wxLogin = E('span', {}, '-');
		this.wxAccounts = E('div', {}, _('Loading...'));
		this.wxStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.wxLog = E('pre', { 'class': 'oc-log', 'style': 'display:none' }, '');
		// Telegram 子卡元素
		this.tgToken = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': '123456789:ABCdef...', 'style': 'flex:1;min-width:14rem' });
		this.tgCode = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': '配对码（私信 Bot 获取）', 'style': 'flex:1;min-width:10rem' });
		this.tgStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.tgState = E('span', {}, _('Loading...'));
		this.tgLog = E('pre', { 'class': 'oc-log', 'style': 'display:none' }, '');
		this.dmScopeLabel = E('span', { 'style': 'font-size:.82em;font-weight:400' }, '');
		this._wechatPoll = L.bind(this.refreshWechat, this);
		return E('div', {}, [
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title', 'style': 'display:flex;justify-content:space-between;align-items:center;gap:1rem' }, [
					E('span', {}, _('Messaging channels (official)')),
					this.dmScopeLabel
				]),
				E('div', { 'class': 'oc-card-body' }, [
					this.channelBox,
					E('div', { 'class': 'oc-actions' }, [
						ocui.button(_('Configure messaging channels (wizard)'), 'cbi-button-positive', L.bind(function() { return this.launchWizard(this.channelWizard, 'channels'); }, this)),
						ocui.button(_('Channel session isolation'), 'cbi-button-action', L.bind(this.showDmScope, this)),
						ocui.button(_('Refresh'), '', L.bind(function() { this.refreshDmScopeLabel(); return this.refreshChannels(true); }, this))
					]),
					E('p', { 'class': 'oc-muted', 'style': 'margin-top:.6rem' }, _('Note: when the official wizard configures the WeChat channel, it only installs the openclaw-weixin plugin and does not start QR login. After installation, click QR login in the WeChat channel card below to sign in.'))
				])
			]),
			this.channelWizard,
			// ── 微信渠道子卡 ──
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('WeChat channel')),
				E('div', { 'class': 'oc-card-body' }, [
					E('div', { 'class': 'oc-field' }, [ E('span', {}, _('WeChat plugin')), this.wxPlugin ]),
					E('div', { 'class': 'oc-field' }, [ E('span', {}, _('Login status')), this.wxLogin ]),
					E('div', { 'class': 'oc-section-label' }, _('Logged-in accounts')),
					this.wxAccounts,
					E('div', { 'class': 'oc-actions', 'style': 'margin-top:.6rem' }, [
						ocui.button(_('Install app'), 'cbi-button-positive', L.bind(function() {
							return this.runWechatInstall(function() { return api.wechatInstall(); }, _('Installing WeChat plugin...'), _('Plugin installed; click QR login to finish signing in.'));
						}, this)),
						ocui.button(_('QR login'), 'cbi-button-action', L.bind(this.showWechatLogin, this)),
						ocui.button(_('Check for upgrades'), 'cbi-button-action', L.bind(function() {
							var self = this;
							return api.wechatUpdateCheck().then(function(r) {
								if (!r.ok) { ocui.setStatus(self.wxStatus, 'error', _(r.message || 'Detection failed')); ocui.hideStatusLater(self.wxStatus); return; }
								if (!r.data.has_upgrade) { ocui.setStatus(self.wxStatus, 'success', _('Already the latest version.')); ocui.hideStatusLater(self.wxStatus); return; }
								// 发现新版本: 内联展示并提供「立即升级」按钮, 不弹窗。黄色提示, 与绿色「已是最新」区分。
								window.clearTimeout(self.wxStatus._ocHideTimer);
								self.wxStatus.className = 'oc-action-status oc-task-warn';
								self.wxStatus.style.display = '';
								dom.content(self.wxStatus, [
									E('span', {}, _('New WeChat plugin version %s available.').format(r.data.latest_version)), ' ',
									ocui.button(_('Upgrade now'), 'cbi-button-action', function() { return self.runWechatInstall(function() { return api.wechatUpgrade(); }, _('Upgrading WeChat plugin...'), _('WeChat plugin upgrade completed.')); })
								]);
							});
						}, this)),
						ocui.button(_('Uninstall app'), 'cbi-button-negative', L.bind(function() {
							var self = this;
							return ocui.confirm(_('Uninstall the WeChat plugin?'), { danger: true, confirmLabel: _('Uninstall') }).then(function(ok) {
								if (!ok) return;
								return self.runWechatInstall(function() { return api.wechatUninstall(); }, _('Uninstalling WeChat plugin...'), _('WeChat plugin uninstalled.'));
							});
						}, this)),
						ocui.button(_('Refresh'), '', L.bind(this.refreshWechat, this))
					]),
					this.wxStatus,
					this.wxLog
				])
			]),
			// ── Telegram 渠道子卡 ──
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('Telegram channel')),
				E('div', { 'class': 'oc-card-body' }, [
					E('p', { 'class': 'oc-muted' }, _('Enter the Bot Token from BotFather; after saving it is added via the official CLI and the gateway restarts automatically (no wizard needed).')),
					E('div', { 'class': 'oc-field', 'style': 'align-items:center' }, [ E('span', {}, _('Bot Token')), this.tgToken ]),
						E('div', { 'class': 'oc-field', 'style': 'align-items:center' }, [ E('span', {}, _('Channel status')), this.tgState ]),
					E('div', { 'class': 'oc-actions', 'style': 'margin-top:.6rem' }, [
						ocui.button(_('Save and enable'), 'cbi-button-positive', L.bind(this.saveTelegram, this)),
						ocui.button(_('Refresh'), '', L.bind(function() { this.refreshDmScopeLabel(); return this.refreshChannels(true); }, this))
					]),
					E('div', { 'class': 'oc-section-label' }, _('Pairing (approve the DM initiator)')),
					E('p', { 'class': 'oc-muted' }, _('After saving the token, click Pairing Helper, then send a private message to your bot on Telegram; the helper auto-captures and approves the pairing request (no need to copy the pairing code). You can also enter the pairing code manually as a fallback.')),
					E('div', { 'class': 'oc-field', 'style': 'align-items:center' }, [ E('span', {}, _('Pairing code (manual fallback)')), this.tgCode ]),
					E('div', { 'class': 'oc-actions', 'style': 'margin-top:.4rem' }, [
						ocui.button(_('Pairing helper'), 'cbi-button-positive', L.bind(this.startPairingAssistant, this)),
						ocui.button(_('Manual approval'), '', L.bind(this.pairTelegram, this))
					]),
					this.tgStatus,
					this.tgLog
				])
			])
		]);
	},

	saveTelegram: function() {
		var self = this;
		var tok = (this.tgToken.value || '').trim();
		if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(tok)) {
			ocui.setStatus(this.tgStatus, 'error', _('Invalid Bot Token format (expected like 123456789:ABC...)'));
			ocui.hideStatusLater(this.tgStatus);
			return;
		}
		return ocui.runOp(this.tgStatus, {
			running: _('"Save Telegram" command submitted'),
			success: _('Telegram channel configured; gateway is restarting.'),
			submit: function() { return api.telegramAdd(tok); },
			pollLog: function() { return api.telegramAddLog(); },
			onLog: function(d) { self.tgLog.style.display = ''; ocui.setLog(self.tgLog, d.log || _('Waiting for output...')); },
			onDone: function(ok) { if (ok) self.tgToken.value = ''; self.refreshChannels(); }
		});
	},

	pairTelegram: function() {
		var self = this;
		var code = (this.tgCode.value || '').trim();
		if (!/^[A-Za-z0-9]{4,16}$/.test(code)) {
			ocui.setStatus(this.tgStatus, 'error', _('Invalid pairing code format'));
			ocui.hideStatusLater(this.tgStatus);
			return;
		}
		return ocui.runOp(this.tgStatus, {
			running: _('"Approve pairing" command submitted'),
			success: _('Pairing approved; the user is now authorized.'),
			submit: function() { return api.telegramPair(code); },
			onDone: function(ok) { if (ok) self.tgCode.value = ''; }
		});
	},

	// 配对助手: 轮询待配对请求, 自动抓取配对码并直接批准(无需手动点); 开启期间持续监听, 可手动停止。
	// 自动批准仅在助手运行时生效, 停止/超时后不再批准, 以限定授权窗口。
	startPairingAssistant: function() {
		var self = this;
		if (this._pairFn) { poll.remove(this._pairFn); this._pairFn = null; }
		var approved = {}, logLines = [], ticks = 0, MAX_TICKS = 100; // 100×3s ≈ 5 分钟后自动停止
		this.tgLog.style.display = '';
		ocui.setLog(this.tgLog, _('Pairing helper started, waiting for a pairing request... Ask the other party to send any private message to your bot on Telegram.'));
		var pushLog = function(line) { logLines.push(line); ocui.setLog(self.tgLog, logLines.join('\n')); };
		var stop = function(msg) {
			if (self._pairFn) { poll.remove(self._pairFn); self._pairFn = null; }
			ocui.setStatus(self.tgStatus, 'success', msg || _('Pairing helper stopped.'));
			ocui.hideStatusLater(self.tgStatus);
		};
		var showRunning = function() {
			window.clearTimeout(self.tgStatus._ocHideTimer);
			self.tgStatus.className = 'oc-action-status oc-task-running';
			self.tgStatus.style.display = '';
			dom.content(self.tgStatus, [ E('span', {}, _('Pairing helper running: ask the other party to send the bot a private message...')), ' ', ocui.button(_('Stop'), '', function() { stop(); }) ]);
		};
		showRunning();
		var fn = function() {
			if (++ticks > MAX_TICKS) { stop(_('Pairing helper timed out and stopped (about 5 minutes).')); return; }
			return api.telegramPairingList().then(function(r) {
				if (!r.ok) return;
				var reqs = ((r.data || {}).requests) || [];
				reqs.forEach(function(x) {
					var code = x.code || x.pairingCode || '';
					var who = x.sender || x.from || x.senderId || x.user || x.username || '';
					if (!code) { console.warn('[openclaw] telegram pairing: 无法识别配对码', x); return; }
					if (approved[code]) return;
					approved[code] = true; // 先占位防重复批准
					pushLog(_('Captured pairing request %s (%s), approving automatically...').format(code, who || _('Unknown')));
					api.telegramPair(code).then(function(pr) {
						if (pr && pr.ok) { pushLog(_('Authorized %s; pairing helper stopped.').format(who || code)); self.refreshChannels(); stop(_('Pairing complete; helper stopped.')); }
						else { delete approved[code]; pushLog(_('Approval failed %s: %s').format(code, _((pr && pr.message) || 'Unknown error'))); }
					}).catch(function(e) { delete approved[code]; pushLog(_('Approval error %s: %s').format(code, _(String(e && e.message || e)))); });
				});
			}).catch(function() {});
		};
		this._pairFn = fn;
		poll.add(fn, 3);
		fn();
	},

	// 清洗安装日志: 去 ANSI 转义。
	cleanWechatLog: function(s) {
		return (s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
	},

	// 通用: 用后端 qrencode 把链接生成清晰可扫的二维码(SVG), 以 <img> data URL 渲染(innerHTML 注入
	// 带 <?xml?> 声明的 SVG 在 HTML 上下文不可靠)。带去重(el._qrUrl)。
	renderQr: function(el, url) {
		if (!el || !url || el._qrUrl === url) return;
		el._qrUrl = url;
		api.qrEncode(url).then(function(r) {
			if (el._qrUrl !== url) return; // 期间链接已刷新, 丢弃过期结果
			if (!r.ok || !r.data || !r.data.svg) return;
			dom.content(el, E('img', { 'src': 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.data.svg) }));
		});
	},

	runWechatInstall: function(submitFn, running, success) {
		var self = this;
		return ocui.runOp(this.wxStatus, {
			running: running, success: success,
			submit: submitFn,
			cancel: function() { return api.taskCancel('openclaw-wechat-install'); },
			onClose: function() { self.wxLog.style.display = 'none'; },
			pollLog: function() { return api.wechatInstallLog(); },
			onLog: function(d) {
				self.wxLog.style.display = '';
				ocui.setLog(self.wxLog, self.cleanWechatLog(d.log) || _('Waiting for output...'));
			},
			onDone: function() { self.refreshWechat(); }
		});
	},

	refreshWechat: function() {
		return api.wechatStatus().then(L.bind(function(result) {
			if (!result.ok) return;
			var d = result.data || {};
			// 状态用徽章呈现, 与上方「消息渠道列表」一致: 已安装=灰(oc-info)、已登录=绿(oc-ok)、否定态=琥珀(oc-warn)。
			// 状态徽章, 与上方「消息渠道列表」一致(着色全由 .oc-badge 类层叠决定, 不再内联)。
			if (d.plugin_installed) {
				var wxPluginEls = [ E('span', { 'class': 'oc-badge oc-info' }, _('Installed')) ];
				if (d.plugin_version) wxPluginEls.push(E('span', { 'style': 'margin-left:.5rem' }, 'v' + d.plugin_version));
				dom.content(this.wxPlugin, wxPluginEls);
			} else {
				dom.content(this.wxPlugin, E('span', { 'class': 'oc-badge oc-warn' }, _('Not installed')));
			}
			dom.content(this.wxLogin, d.logged_in
				? E('span', { 'class': 'oc-badge oc-ok' }, _('Logged in'))
				: E('span', { 'class': 'oc-badge oc-warn' }, _('Not logged in')));
			dom.content(this.wxAccounts, (d.accounts || []).length ? d.accounts.map(L.bind(function(account) {
				return E('div', { 'class': 'oc-field' }, [
					E('span', {}, account.name || account.id),
					ocui.button(_('Log out'), 'cbi-button-negative', L.bind(function() {
						var self = this;
						return ocui.confirm(_('Log out this WeChat account?'), { danger: true, confirmLabel: _('Log out') }).then(function(ok) {
							if (!ok) return;
							return ocui.runOp(self.wxStatus, { running: _('Logging out account...'), success: _('Account logged out.'), submit: function() { return api.wechatLogout(account.id); }, onDone: L.bind(function() { self.refreshWechat(); self.refreshChannels(); }, self) });
						});
					}, this))
				]);
			}, this)) : [ E('p', { 'class': 'oc-muted' }, _('No logged-in accounts yet')) ]);
		}, this));
	},

	// 从登录输出里提取字符二维码块(去 ANSI; 只留块字符行)，只返回最后一个块（避免 QR 刷新后积累多个）。
	extractWechatQr: function(s) {
		s = (s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
		var lines = s.split('\n'), cur = [], groups = [];
		for (var i = 0; i < lines.length; i++) {
			if (/^[▀-▟\s]+$/.test(lines[i]) && lines[i].replace(/\s/g, '').length > 8) {
				cur.push(lines[i]);
			} else if (cur.length) {
				groups.push(cur.join('\n'));
				cur = [];
			}
		}
		if (cur.length) groups.push(cur.join('\n'));
		return groups.length ? groups[groups.length - 1] : s;
	},

	showWechatLogin: function() {
		var self = this;
		var qrEl = E('pre', { 'class': 'oc-qr' }, _('Starting login, please wait...'));
		var urlEl = E('p', { 'style': 'display:none; font-size:.85em; margin:.6rem 0 0; word-break:break-all' });
		var logEl = E('pre', { 'style': 'margin-top:.5rem; max-height:80px; overflow-y:auto; font-size:.8em; white-space:pre-wrap; border-top:1px solid var(--cbi-border-color,#ddd); padding-top:.4rem; color:var(--cbi-muted-fg,#666)' }, _('Starting...'));
		var fn = L.bind(function() {
			return api.wechatLoginStatus().then(L.bind(function(result) {
				var d = result.data || {};
				var qr = this.extractWechatQr(d.qrcode || d.log || '');
				if (qr.trim()) qrEl.textContent = qr;
				if (d.qrcode_url) {
					urlEl.style.display = '';
					dom.content(urlEl, [ _('Cannot scan? Click to open:'), E('a', { href: d.qrcode_url, target: '_blank', rel: 'noopener' }, d.qrcode_url) ]);
				}
				var rawLog = this.cleanWechatLog(d.log || '');
				var lines = rawLog.split('\n');
				var lastQrEnd = -1;
				for (var i = lines.length - 1; i >= 0; i--) {
					if (/^[▀-▟\s]+$/.test(lines[i]) && lines[i].replace(/\s/g, '').length > 8) { lastQrEnd = i; break; }
				}
				var logText = lastQrEnd >= 0
					? lines.slice(lastQrEnd + 1).filter(function(l) { return !/^https?:\/\//.test(l.trim()); }).join('\n').trim()
					: lines.filter(function(l) { return !(/^[▀-▟\s]+$/.test(l) && l.replace(/\s/g, '').length > 8); }).join('\n').trim();
				if (logText) { logEl.textContent = logText; logEl.scrollTop = logEl.scrollHeight; }
				if (d.state === 'success' || d.state === 'failed') { poll.remove(fn); this.refreshWechat(); }
			}, this));
		}, this);
		return api.wechatLogin().then(L.bind(function(result) {
			if (!result.ok) { ocui.setStatus(self.wxStatus, 'error', _(result.message || 'Login failed to start')); return; }
			ui.showModal(_('WeChat QR login'), [ qrEl, urlEl, logEl, E('div', { 'class': 'right' }, [
				ocui.closeButton(_('Close'), function() { poll.remove(fn); api.wechatLoginCancel(); })
			]) ]);
			poll.add(fn, 2);
			fn();
		}, this));
	},

	// scope 值 → 友好名(用于标题栏当前配置展示)。
	dmScopeName: function(scope) {
		var M = { 'main': _('Share all'), 'per-peer': _('Isolate per peer'), 'per-channel-peer': _('Isolate per channel'), 'per-account-channel-peer': _('Isolate per account + channel') };
		return M[scope] || scope;
	},

	// 在「消息渠道（官方）」标题栏右侧只读展示当前会话隔离配置。
	refreshDmScopeLabel: function() {
		return api.dmScope().then(L.bind(function(r) {
			if (!this.dmScopeLabel) return;
			var scope = ((r.data || {}).scope) || 'main';
			dom.content(this.dmScopeLabel, [ _('Session isolation:') + this.dmScopeName(scope) + ' ', E('code', { 'style': 'opacity:.85' }, scope) ]);
		}, this)).catch(function() {});
	},

	// 渠道会话隔离: 弹窗四选(读当前值预选), 保存→写配置+重启网关, 取消→关闭。
	showDmScope: function() {
		var self = this;
		var OPTS = [
			{ v: 'main', label: _('Share all (default)'), desc: _('All channels and all peers share one session; selecting and saving this clears the option, reverting to no explicit configuration.') },
			{ v: 'per-peer', label: _('Isolate per peer'), desc: _('The same peer is shared across channels; different peers stay separate.') },
			{ v: 'per-channel-peer', label: _('Isolate per channel'), desc: _('The same peer has separate sessions per channel, with no shared memory.') },
			{ v: 'per-account-channel-peer', label: _('Isolate per account + channel'), desc: _('Adds an account dimension for multi-account scenarios; strongest isolation.') }
		];
		return api.dmScope().then(function(r) {
			var cur = ((r.data || {}).scope) || 'main';
			var radios = OPTS.map(function(o) {
				var input = E('input', { 'type': 'radio', 'name': 'oc-dmscope', 'value': o.v, 'style': 'margin-top:.2rem' });
				if (o.v === cur) input.checked = true;
				return E('label', { 'style': 'display:flex;gap:.6rem;align-items:flex-start;cursor:pointer' }, [
					input,
					E('div', {}, [
						E('div', {}, [ o.label, ' ', E('code', { 'style': 'opacity:.65;font-size:.85em' }, o.v) ]),
						E('div', { 'class': 'oc-muted', 'style': 'font-size:.85em' }, o.desc)
					])
				]);
			});
			var getVal = function() {
				for (var i = 0; i < radios.length; i++) { var inp = radios[i].firstChild; if (inp.checked) return inp.value; }
				return cur;
			};
			var status = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
			ui.showModal(_('Channel session isolation'), [
				E('p', { 'class': 'oc-muted' }, _('Choose how to isolate direct-message sessions; saving writes the config and restarts the gateway to apply.')),
				E('div', { 'style': 'display:flex;flex-direction:column;gap:12px;margin:10px 0' }, radios),
				status,
				E('div', { 'class': 'right', 'style': 'margin-top:12px' }, [
					ocui.closeButton(_('Cancel')),
					' ',
					ocui.button(_('Save'), 'cbi-button-positive', function() {
						var val = getVal();
						if (val === cur) { ui.hideModal(); return; }
						return ocui.runOp(status, {
							running: _('Saving and restarting gateway...'),
							success: _('Saved; gateway is restarting.'),
							submit: function() { return api.dmScopeSet(val); },
							onDone: function(ok) { if (ok) { self.refreshDmScopeLabel(); ui.hideModal(); } }
						});
					})
				])
			]);
		});
	},

	refreshChannels: function(force) {
		// 同时取渠道列表 + Telegram 身份状态(显示名/已配对); telegram_status 失败不影响其余渲染。
		// force===true(「刷新」按钮)时绕过后端 getMe 缓存强制重拉。
		return Promise.all([ api.channelsList(), api.telegramStatus(force === true ? '1' : '').catch(function() { return { ok: false, data: {} }; }) ]).then(L.bind(function(results) {
			var result = results[0] || {};
			var tg = (results[1] && results[1].data) || {};
			var d = result.data || {};
			var chat = d.chat || {};
			// Telegram 机器人标识(显示名优先, 退用户名, 再退 bot 数字 ID)。
			var tgLabel = tg.bot_name || (tg.bot_username ? ('@' + tg.bot_username) : (tg.bot_id ? _('Bot ID %s').format(tg.bot_id) : ''));
			var tgIdLabel = tg.bot_username ? (tg.bot_name ? (tg.bot_name + ' (@' + tg.bot_username + ')') : ('@' + tg.bot_username)) : tgLabel;
			var tgPaired = tg.paired_ids || [];
			// 更新 Telegram 卡片「渠道状态」行(详情: 显示名+用户名 + 全列已配对 ID)。
			if (this.tgState) {
				if (!tg.configured) {
					dom.content(this.tgState, E('span', { 'class': 'oc-badge oc-warn' }, _('Not configured (save the Bot Token first)')));
				} else {
					var detail = [ E('span', { 'class': 'oc-badge oc-info' }, _('Configured')) ];
					if (tgIdLabel) detail.push(E('span', { 'style': 'margin-left:.5rem' }, tgIdLabel));
					// 「已配对」用绿色徽章, 后跟原色文字「用户：<ID>」; 未配对用琥珀徽章。
					if (tgPaired.length) {
						detail.push(E('span', { 'class': 'oc-badge oc-ok', 'style': 'margin-left:.5rem' }, _('Paired')));
						detail.push(E('span', { 'style': 'margin-left:.5rem' }, _('Users: %s').format(tgPaired.join('、'))));
					} else {
						detail.push(E('span', { 'class': 'oc-badge oc-warn', 'style': 'margin-left:.5rem' }, _('Not paired')));
					}
					dom.content(this.tgState, detail);
				}
			}
			var names = Object.keys(chat);
			if (!names.length) {
				dom.content(this.channelBox, E('p', { 'class': 'oc-muted' }, result.ok ? _('No channels configured yet. Use the wizard below to configure.') : (_(result.message || 'Failed to read channels'))));
				return;
			}
			var rows = names.map(function(name) {
				var c = chat[name] || {};
				var accts = c.accounts || [];
				var configBadge = E('span', { 'class': 'oc-badge oc-info' }, _('Configured'));
				var second;
				if (name === 'telegram') {
					// 显示名 + 配对计数(详细 ID 在 Telegram 卡)。
					second = [];
					if (tgLabel) second.push(E('span', {}, tgLabel));
					second.push(tgPaired.length
						? E('span', { 'class': 'oc-badge oc-ok' }, _('%s paired').format(tgPaired.length))
						: E('span', { 'class': 'oc-badge oc-warn' }, _('Not paired')));
				} else if (name === 'openclaw-weixin') {
					// 机器人前缀(账号 id 去掉固定后缀 -im-bot) + 已登录绿标; 无账号则未登录, 均不显示计数。
					var acc = (accts[0] && accts[0].accountId) || '';
					var prefix = acc.replace(/-im-bot$/, '');
					second = prefix
						? [ E('span', {}, prefix), E('span', { 'class': 'oc-badge oc-ok' }, _('Logged in')) ]
						: [ E('span', { 'class': 'oc-badge oc-warn' }, _('Not logged in')) ];
				} else {
					// 其它渠道维持原逻辑: 已登录 N / Bot 在线离线 / 未登录。
					var isBot = accts.some(function(a) { return a && typeof a === 'object' && (a.tokenSource || a.tokenStatus); });
					if (!accts.length) second = [ E('span', { 'class': 'oc-badge oc-warn' }, _('Not logged in')) ];
					else if (isBot) { var connected = accts.some(function(a) { return a && a.connected; }); second = [ connected ? E('span', { 'class': 'oc-badge oc-ok' }, _('Bot online')) : E('span', { 'class': 'oc-badge oc-warn' }, _('Bot offline')) ]; }
					else second = [ E('span', { 'class': 'oc-badge oc-ok' }, _('%s logged in').format(accts.length)) ];
				}
				var stateCell = E('span', { 'style': 'display:inline-flex;gap:.4rem;flex-wrap:wrap;align-items:center' }, [ configBadge ].concat(second));
				return E('tr', {}, [ E('td', {}, name), E('td', {}, stateCell), E('td', {}, c.origin || '-') ]);
			});
			dom.content(this.channelBox, E('table', { 'class': 'oc-table' }, [
				E('tr', {}, [ E('th', {}, _('Channels')), E('th', {}, _('Status')), E('th', {}, _('Source')) ])
			].concat(rows)));
		}, this));
	},

	// ── 日志 ──
	renderLogTab: function() {
		this.logLines = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { value: '50', selected: 'selected' }, '50'),
			E('option', { value: '100' }, '100'),
			E('option', { value: '200' }, '200')
		]);
		this.logAuto = E('input', { type: 'checkbox' });
		this._logPoll = L.bind(this.refreshLogs, this);
		this.logAuto.addEventListener('change', L.bind(function() {
			if (this.logAuto.checked) poll.add(this._logPoll, 2);
			else poll.remove(this._logPoll);
		}, this));
		this.logBox = E('pre', { 'class': 'oc-log' }, _('Click Load log to fetch the latest logs.'));
		return E('div', {}, [
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('Gateway log')),
				E('div', { 'class': 'oc-card-body' }, [
					E('div', { 'class': 'oc-actions', 'style': 'align-items:center' }, [
						E('span', {}, _('Lines')), this.logLines,
						ocui.button(_('Load log'), 'cbi-button-action', L.bind(this.refreshLogs, this)),
						ocui.button(_('Clear'), '', L.bind(function() {
							if (this._logPoll) poll.remove(this._logPoll);
							this.logAuto.checked = false;
							this.logBox.textContent = _('Click Load log to fetch the latest logs.');
						}, this)),
						E('label', { 'style': 'display:flex;align-items:center;gap:.35rem' }, [ this.logAuto, _('Auto refresh (2s)') ])
					]),
					this.logBox
				])
			])
		]);
	},

	refreshLogs: function() {
		return api.logsTail(parseInt(this.logLines.value, 10) || 200).then(L.bind(function(result) {
			var d = result.data || {};
			var lines = d.lines || [];
			if (!lines.length) {
				this.logBox.textContent = result.ok ? _('No logs yet (the gateway may not be running).') : (_(result.message || 'Failed to read logs'));
				return;
			}
			var text = lines.map(function(x) {
				if (x.text !== undefined) return x.text;
				var t = (x.time || '').replace('T', ' ').replace(/\..*$/, '');
				return '[' + t + '] ' + (x.level || '').toUpperCase() + ' ' + (x.subsystem ? '(' + x.subsystem + ') ' : '') + (x.message || '');
			}).join('\n');
			ocui.setLog(this.logBox, text);
		}, this));
	},

	switchTab: function(name) {
		var tabs = this.tabDefs;
		// 离开 tab 时收尾: 停向导 ttyd; 离开渠道停微信轮询; 离开日志停轮询并复位面板
		if (this._activeTab && this._activeTab !== name) {
			if (this._activeTab === 'wizard' || this._activeTab === 'provider' || this._activeTab === 'channel')
				this.stopWizards();
			if (this._activeTab === 'channel' && this._wechatPoll) poll.remove(this._wechatPoll);
			if (this._activeTab === 'log') {
				if (this._logPoll) poll.remove(this._logPoll);
				if (this.logAuto) this.logAuto.checked = false;
				if (this.logBox) this.logBox.textContent = _('Click Load log to fetch the latest logs.');
			}
			if (this._activeTab === 'health') this.resetHealthTab();
		}
		this._activeTab = name;
		for (var i = 0; i < tabs.length; i++) {
			var active = tabs[i].name === name;
			tabs[i].panel.style.display = active ? '' : 'none';
			tabs[i].btn.classList.toggle('oc-tab-active', active);
		}
		if (name === 'provider' && !this._providerLoaded) { this._providerLoaded = true; this.refreshProviders(); }
		if (name === 'channel') {
			if (!this._channelLoaded) { this._channelLoaded = true; this.refreshChannels(); this.refreshWechat(); this.refreshDmScopeLabel(); }
			if (this._wechatPoll) poll.add(this._wechatPoll, 10);
		}
		// 日志 tab 默认不加载, 等用户点「加载日志」(或开自动刷新)。
	},

	stopWizards: function() {
		api.wizardStop();
		[ this.fullWizard, this.providerWizard, this.channelWizard, this.shellTerm ].forEach(function(c) {
			if (c) { c.style.display = 'none'; dom.content(c, ''); }
		});
	},

	render: function(results) {
		ocui.applyTheme();
		this.status = (results[0] || {}).data || {};
		this.token = (results[1] || {}).data || {};

		if (!this.status.oc_version) {
			return E('div', {}, [
				ocui.cssLink(),
				E('div', { 'class': 'oc-header' }, [ E('h2', {}, _('Configuration')) ]),
				E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-body' }, [
					E('p', { 'class': 'oc-badge oc-error' }, _('OpenClaw runtime is not installed; install it under Basic Settings first.'))
				]) ])
			]);
		}

		this.tabDefs = [
			{ name: 'wizard', label: _('Official setup'), panel: this.renderWizardTab() },
			{ name: 'provider', label: _('Provider'), panel: this.renderProviderTab() },
			{ name: 'channel', label: _('Channels'), panel: this.renderChannelTab() },
			{ name: 'health', label: _('Health check'), panel: this.renderHealthTab() },
			{ name: 'log', label: _('Log'), panel: this.renderLogTab() }
		];

		var self = this;
		var tabBar = E('div', { 'class': 'oc-tabs' }, this.tabDefs.map(function(t) {
			t.btn = E('button', { 'type': 'button', 'class': 'oc-tab' }, t.label);
			t.btn.addEventListener('click', function() { self.switchTab(t.name); });
			t.panel.style.display = 'none';
			return t.btn;
		}));

		var page = E('div', {}, [
			ocui.cssLink(),
			E('div', { 'class': 'oc-header' }, [
				E('h2', {}, _('Configuration')),
				E('p', { 'class': 'oc-muted' }, _('Graphical access to the official OpenClaw CLI: health check, doctor fix, provider and channel configuration, log queries.'))
			]),
			tabBar
		].concat(this.tabDefs.map(function(t) { return t.panel; })));

		window.setTimeout(function() { self.switchTab('wizard'); }, 0);
		return page;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
