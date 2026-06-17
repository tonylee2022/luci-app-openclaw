'use strict';
'require view';
'require poll';
'require ui';
'require dom';
'require openclaw.api as api';
'require openclaw.ui as ocui';

function notify(result) {
	ui.addNotification(null, E('p', {}, result.message || (result.ok ? _('操作成功') : _('操作失败'))), result.ok ? 'info' : 'error');
	return result;
}

// 带 spinner + 防重复点击的按钮 (与 overview.js 一致)
function button(label, css, handler) {
	var btn = E('button', { 'type': 'button', 'class': 'cbi-button ' + css }, label);
	btn.addEventListener('click', function(ev) {
		ev.preventDefault();
		ev.stopPropagation();
		if (btn.disabled) return;
		btn.disabled = true;
		btn.classList.add('oc-btn-loading');
		Promise.resolve().then(function() { return handler(ev); }).catch(function(err) {
			ui.addNotification(null, E('p', {}, String(err)), 'error');
		}).finally(function() {
			btn.disabled = false;
			btn.classList.remove('oc-btn-loading');
		});
	});
	return btn;
}

function closeButton(label, beforeClose) {
	var btn = E('button', { 'type': 'button', 'class': 'cbi-button' }, label);
	btn.addEventListener('click', function(ev) {
		ev.preventDefault();
		ev.stopPropagation();
		if (beforeClose) beforeClose();
		ui.hideModal();
	});
	return btn;
}

function severityClass(sev) {
	return sev === 'error' ? 'oc-error' : sev === 'warning' ? 'oc-warn' : 'oc-info';
}

function severityLabel(sev) {
	return sev === 'error' ? _('错误') : sev === 'warning' ? _('警告') : _('提示');
}

return view.extend({
	load: function() {
		return Promise.all([ api.status(), api.gatewayToken() ]);
	},

	// ── 嵌入式终端: 按需拉起 ttyd 跑官方 configure 向导 (真实 PTY, 以 openclaw 运行) ──
	launchWizard: function(container, section) {
		dom.content(container, E('div', { 'class': 'oc-card-body' }, E('p', { 'class': 'oc-muted' }, _('正在启动配置向导终端...'))));
		container.style.display = '';
		return api.wizardStart(section).then(L.bind(function(result) {
			if (!result.ok || !result.data || !result.data.port) {
				dom.content(container, E('div', { 'class': 'oc-card-body' }, E('p', { 'class': 'oc-badge oc-error' }, result.message || _('向导启动失败，请确认已安装 ttyd (opkg install ttyd)。'))));
				return;
			}
			var url = window.location.protocol + '//' + window.location.hostname + ':' + result.data.port + '/';
			dom.content(container, E('div', { 'class': 'oc-card-body' }, [
				E('p', { 'class': 'oc-muted' }, _('已在下方打开官方配置向导终端：↑↓ 移动、空格/Tab 选中、回车确认。配置完成后点下方「完成并重启网关」生效。')),
				E('iframe', { 'class': 'oc-iframe', src: url, allow: 'clipboard-read; clipboard-write', allowfullscreen: 'true' }),
				E('div', { 'class': 'oc-actions', 'style': 'margin-top:.6rem' }, [
					button(_('重启网关'), 'cbi-button-positive', L.bind(this.finishWizard, this, container)),
					button(_('关闭'), '', L.bind(function() { api.wizardStop(); container.style.display = 'none'; }, this))
				])
			]));
			window.setTimeout(function() { container.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
		}, this));
	},

	// 重启网关并就地显示完整进度(提交→重启中→就绪/失败/超时), 不必切到基本设置查看。
	restartGateway: function(statusEl, onDone) {
		ocui.setStatus(statusEl, 'running', _('「重启网关」命令已提交，正在重启...'));
		return api.serviceAction('restart_gateway').then(function(r) {
			if (r && r.ok === false) { ocui.setStatus(statusEl, 'error', r.message || _('重启失败')); return; }
			var start = Date.now(), to = 40000;
			return new Promise(function(resolve) {
				(function tick() {
					api.status().then(function(res) {
						var d = (res && res.data) || {};
						if (d.gateway_running === true) {
							ocui.setStatus(statusEl, 'success', _('网关已就绪，运行中（端口 %s）。').format(d.port || '-'));
							ocui.hideStatusLater(statusEl);
							if (onDone) onDone(true);
							return resolve();
						}
						if (d.gateway_failed === true) {
							ocui.setStatus(statusEl, 'error', _('网关启动失败，请到「日志」排查。'));
							if (onDone) onDone(false);
							return resolve();
						}
						if (Date.now() - start > to) {
							ocui.setStatus(statusEl, 'error', _('重启超时，网关未在预期时间内就绪，请稍后刷新查看。'));
							return resolve();
						}
						ocui.setStatus(statusEl, 'running', d.gateway_starting ? _('网关启动中，请稍候...') : _('网关重启中，请稍候...'));
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
			E('p', { 'class': 'oc-muted' }, _('配置已保存，正在重启网关使其生效：')),
			status
		]));
		return this.restartGateway(status);
	},

	// 在嵌入终端里以 openclaw 身份打开 openclaw-shell, 让用户直接敲 CLI 命令配置/交互。
	launchShell: function(container) {
		dom.content(container, E('div', { 'class': 'oc-card-body' }, E('p', { 'class': 'oc-muted' }, _('正在启动 openclaw-shell 终端...'))));
		container.style.display = '';
		return api.wizardStart('shell').then(L.bind(function(result) {
			if (!result.ok || !result.data || !result.data.port) {
				dom.content(container, E('div', { 'class': 'oc-card-body' }, E('p', { 'class': 'oc-badge oc-error' }, result.message || _('终端启动失败，请确认已安装 ttyd (opkg install ttyd)。'))));
				return;
			}
			var url = window.location.protocol + '//' + window.location.hostname + ':' + result.data.port + '/';
			var shStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
			dom.content(container, E('div', { 'class': 'oc-card-body' }, [
				E('p', { 'class': 'oc-muted' }, _('已打开 openclaw-shell（以 openclaw 用户运行，环境已配好）。可直接敲 CLI 命令配置/交互，例如：openclaw configure、openclaw channels add --channel telegram --token <token>、openclaw models、openclaw doctor 等。配置类命令改动后，点下方「重启网关」使其生效。完成后点「关闭」结束终端。')),
				E('iframe', { 'class': 'oc-iframe', src: url, allow: 'clipboard-read; clipboard-write', allowfullscreen: 'true' }),
				E('div', { 'class': 'oc-actions', 'style': 'margin-top:.6rem' }, [
					button(_('重启网关'), 'cbi-button-action', L.bind(function() { return this.restartGateway(shStatus); }, this)),
					button(_('关闭'), '', L.bind(function() { api.wizardStop(); container.style.display = 'none'; }, this))
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
				E('div', { 'class': 'oc-card-title' }, _('官方配置')),
				E('div', { 'class': 'oc-card-body' }, [
					E('p', { 'class': 'oc-muted' }, _('在嵌入终端里运行 OpenClaw 官方完整配置向导（工作区、模型、网关、渠道、技能等全部分段），用选项交互完成首次或全面配置。')),
					E('div', { 'class': 'oc-actions' }, [
						button(_('官方配置向导'), 'cbi-button-positive', L.bind(function() { return this.launchWizard(this.fullWizard, 'full'); }, this)),
						button(_('openclaw-shell（命令行）'), 'cbi-button-action', L.bind(function() { return this.launchShell(this.shellTerm); }, this))
					]),
					E('p', { 'class': 'oc-muted', 'style': 'margin-top:.6rem' }, _('向导交互不顺时，可改用 openclaw-shell 直接敲 CLI 命令配置（更可靠）。'))
				])
			]),
			this.fullWizard,
			this.shellTerm
		]);
	},

	// ── 健康检查 ──
	renderHealthTab: function() {
		this.findingsBox = E('div', {}, E('p', { 'class': 'oc-muted' }, _('点击「运行健康检查」开始诊断。')));
		this.healthStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.fixState = E('div', { 'class': 'oc-task-state', 'style': 'display:none' });
		this.fixLog = E('pre', { 'class': 'oc-log', 'style': 'display:none' }, '');
		return E('div', {}, [
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('健康检查与修复')),
				E('div', { 'class': 'oc-card-body' }, [
					E('div', { 'class': 'oc-actions' }, [
						button(_('运行健康检查'), 'cbi-button-action', L.bind(this.runLint, this)),
						button(_('一键修复 (doctor --fix)'), 'cbi-button-positive', L.bind(this.runFix, this))
					]),
					this.healthStatus,
					E('div', { 'class': 'oc-task-wrap' }, [ this.fixState, this.fixLog ]),
					this.findingsBox
				])
			])
		]);
	},

	renderFindings: function(result) {
		var d = result.data || {};
		var findings = d.findings || [];
		var summary = E('p', { 'class': 'oc-muted' }, _('共运行 %s 项检查，发现 %s 条结果。').format(d.checksRun || 0, findings.length));
		if (!findings.length) {
			dom.content(this.findingsBox, [ summary, E('p', { 'class': 'oc-badge oc-ok' }, _('一切正常，未发现问题。')) ]);
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

	runLint: function() {
		var self = this;
		dom.content(this.findingsBox, E('p', { 'class': 'oc-muted' }, _('正在运行健康检查，请稍候...')));
		return ocui.runOp(this.healthStatus, {
			running: _('正在运行健康检查...'),
			success: _('健康检查完成。'),
			submit: function() {
				return api.doctorLint().then(function(result) {
					if (result.ok) self.renderFindings(result);
					else dom.content(self.findingsBox, E('p', { 'class': 'oc-badge oc-error' }, result.message || _('健康检查失败')));
					return result;
				});
			}
		});
	},

	runFix: function() {
		var self = this;
		return ocui.runOp(this.healthStatus, {
			running: _('修复任务正在运行，请稍候...'),
			success: _('修复完成。'),
			submit: function() { return api.doctorFix(); },
			cancel: function() { return api.taskCancel('openclaw-doctor-fix'); },
			onClose: function() { self.fixLog.style.display = 'none'; self.fixState.style.display = 'none'; },
			pollLog: function() { return api.doctorFixLog(); },
			onLog: function(d) {
				self.fixState.style.display = '';
				self.fixLog.style.display = '';
				ocui.setLog(self.fixLog, d.log || (d.running ? _('修复进行中...') : _('暂无输出')));
				if (d.done) {
					self.fixState.className = 'oc-task-state ' + (d.exit_code === 0 ? 'oc-task-success' : 'oc-task-error');
					self.fixState.textContent = d.exit_code === 0 ? _('修复完成。') : _('修复失败，退出码：%s').format(d.exit_code);
				} else {
					self.fixState.className = 'oc-task-state oc-task-running';
					self.fixState.textContent = _('修复任务正在运行，请稍候...');
				}
			}
		});
	},

	// ── 提供商 ──
	renderProviderTab: function() {
		this.providerBox = E('div', {}, E('p', { 'class': 'oc-muted' }, _('加载中...')));
		this.providerWizard = E('div', { 'class': 'oc-card', 'style': 'display:none' });
		return E('div', {}, [
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('模型与提供商')),
				E('div', { 'class': 'oc-card-body' }, [
					this.providerBox,
					E('div', { 'class': 'oc-actions' }, [
						button(_('配置模型/提供商'), 'cbi-button-positive', L.bind(function() { return this.launchWizard(this.providerWizard, 'model'); }, this)),
						button(_('设置活跃模型'), 'cbi-button-action', L.bind(this.showSetActiveModel, this)),
						button(_('刷新'), '', L.bind(this.refreshProviders, this))
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
					E('span', {}, _('活跃模型')), E('strong', {}, d.primary_model || _('未配置')),
					E('span', {}, _('网关端口')), E('span', {}, d.gateway_port || '-'),
					E('span', {}, _('绑定模式')), E('span', {}, d.gateway_bind || '-')
				])
			];
			items.push(E('div', { 'class': 'oc-section-label' }, _('已配置提供商')));
			if ((d.providers || []).length) {
				items.push(E('table', { 'class': 'oc-table' }, [
					E('tr', {}, [ E('th', {}, _('名称')), E('th', {}, _('授权')), E('th', {}, _('已配置模型')) ])
				].concat(d.providers.map(function(p) {
					return E('tr', {}, [
						E('td', {}, p.name),
						E('td', {}, p.auth || '-'),
						E('td', {}, '' + (p.model_count || 0))
					]);
				}))));
			} else {
				items.push(E('p', { 'class': 'oc-muted' }, _('尚未配置任何提供商。点击下方按钮用官方向导配置。')));
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
				ui.showModal(_('设置活跃模型'), [
					E('p', { 'class': 'oc-muted' }, _('没有可用模型：需要先在「配置模型/提供商」里配置模型并完成提供商授权。')),
					E('div', { 'class': 'right' }, [ closeButton(_('关闭')) ])
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
					running: _('正在设置活跃模型...'),
					success: _('活跃模型已设置，网关重启中。'),
					submit: function() { return api.modelSet(sel.value); },
					onDone: L.bind(function(ok) {
						if (ok) api.serviceAction('restart_gateway');
						this.refreshProviders();
					}, this)
				});
			}, this);
			ui.showModal(_('设置活跃模型'), [
				E('p', { 'class': 'oc-muted' }, _('在已配置且已授权的模型中选择活跃（默认）模型，保存后将自动重启网关生效。')),
				E('div', { 'class': 'oc-field' }, [ E('span', {}, _('活跃模型')), sel ]),
				status,
				E('div', { 'class': 'right' }, [
					closeButton(_('关闭')),
					button(_('保存'), 'cbi-button-positive', doSet)
				])
			]);
		}, this));
	},

	// ── 渠道 ──
	renderChannelTab: function() {
		this.channelBox = E('div', {}, E('p', { 'class': 'oc-muted' }, _('加载中...')));
		this.channelWizard = E('div', { 'class': 'oc-card', 'style': 'display:none' });
		// 微信子卡的状态元素
		this.wxPlugin = E('span', {}, '-');
		this.wxLogin = E('span', {}, '-');
		this.wxAccounts = E('div', {}, _('加载中...'));
		this.wxStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.wxLog = E('pre', { 'class': 'oc-log', 'style': 'display:none' }, '');
		// Telegram 子卡元素
		this.tgToken = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': '123456789:ABCdef...', 'style': 'flex:1;min-width:14rem' });
		this.tgCode = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': '配对码（私信 Bot 获取）', 'style': 'flex:1;min-width:10rem' });
		this.tgStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.tgLog = E('pre', { 'class': 'oc-log', 'style': 'display:none' }, '');
		this._wechatPoll = L.bind(this.refreshWechat, this);
		return E('div', {}, [
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('消息渠道（官方）')),
				E('div', { 'class': 'oc-card-body' }, [
					this.channelBox,
					E('div', { 'class': 'oc-actions' }, [
						button(_('配置消息渠道（向导）'), 'cbi-button-positive', L.bind(function() { return this.launchWizard(this.channelWizard, 'channels'); }, this)),
						button(_('刷新'), '', L.bind(this.refreshChannels, this))
					]),
					E('p', { 'class': 'oc-muted', 'style': 'margin-top:.6rem' }, _('说明：官方向导配置微信渠道时只会安装 openclaw-weixin 插件，不会进入扫码登录。安装完成后，请到下方「微信渠道」卡片点击「扫码登录」完成账号登录。'))
				])
			]),
			this.channelWizard,
			// ── 微信渠道子卡 ──
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('微信渠道')),
				E('div', { 'class': 'oc-card-body' }, [
					E('div', { 'class': 'oc-field' }, [ E('span', {}, _('微信插件')), this.wxPlugin ]),
					E('div', { 'class': 'oc-field' }, [ E('span', {}, _('登录状态')), this.wxLogin ]),
					E('div', { 'class': 'oc-section-label' }, _('已登录账号')),
					this.wxAccounts,
					E('div', { 'class': 'oc-actions', 'style': 'margin-top:.6rem' }, [
						button(_('安装插件'), 'cbi-button-positive', L.bind(function() {
							return this.runWechatInstall(function() { return api.wechatInstall(); }, _('正在安装微信插件...'), _('插件已安装，请点「扫码登录」完成登录。'));
						}, this)),
						button(_('扫码登录'), 'cbi-button-action', L.bind(this.showWechatLogin, this)),
						button(_('检测升级'), 'cbi-button-action', L.bind(function() {
							var self = this;
							return api.wechatUpdateCheck().then(function(r) {
								if (!r.ok) { ocui.setStatus(self.wxStatus, 'error', r.message || _('检测失败')); ocui.hideStatusLater(self.wxStatus); return; }
								if (!r.data.has_upgrade) { ocui.setStatus(self.wxStatus, 'success', _('已是最新版本。')); ocui.hideStatusLater(self.wxStatus); return; }
								if (!confirm(_('发现微信插件版本 %s，立即升级？').format(r.data.latest_version))) return;
								return self.runWechatInstall(function() { return api.wechatUpgrade(); }, _('正在升级微信插件...'), _('微信插件升级完成。'));
							});
						}, this)),
						button(_('卸载插件'), 'cbi-button-negative', L.bind(function() {
							if (!confirm(_('确定卸载微信插件？'))) return;
							return this.runWechatInstall(function() { return api.wechatUninstall(); }, _('正在卸载微信插件...'), _('微信插件已卸载。'));
						}, this)),
						button(_('刷新'), '', L.bind(this.refreshWechat, this))
					]),
					this.wxStatus,
					this.wxLog
				])
			]),
			// ── Telegram 渠道子卡 ──
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('Telegram 渠道')),
				E('div', { 'class': 'oc-card-body' }, [
					E('p', { 'class': 'oc-muted' }, _('填入 BotFather 提供的 Bot Token，保存后通过官方 CLI 添加并自动重启网关生效（无需进向导）。')),
					E('div', { 'class': 'oc-field', 'style': 'align-items:center' }, [ E('span', {}, _('Bot Token')), this.tgToken ]),
					E('div', { 'class': 'oc-actions', 'style': 'margin-top:.6rem' }, [
						button(_('保存并启用'), 'cbi-button-positive', L.bind(this.saveTelegram, this)),
						button(_('刷新'), '', L.bind(this.refreshChannels, this))
					]),
					E('div', { 'class': 'oc-section-label' }, _('配对（审批私信发起者）')),
					E('p', { 'class': 'oc-muted' }, _('保存 token 后，用 Telegram 给你的 Bot 发一条私信，Bot 会回一个配对码；把配对码填到这里点「审批配对」，即可允许该用户使用。')),
					E('div', { 'class': 'oc-field', 'style': 'align-items:center' }, [ E('span', {}, _('配对码')), this.tgCode ]),
					E('div', { 'class': 'oc-actions', 'style': 'margin-top:.4rem' }, [
						button(_('审批配对'), 'cbi-button-positive', L.bind(this.pairTelegram, this)),
						button(_('查看待配对'), '', L.bind(this.listTelegramPairing, this))
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
			ocui.setStatus(this.tgStatus, 'error', _('Bot Token 格式无效（应形如 123456789:ABC...）'));
			ocui.hideStatusLater(this.tgStatus);
			return;
		}
		return ocui.runOp(this.tgStatus, {
			running: _('「保存 Telegram」命令已提交'),
			success: _('Telegram 渠道已配置，网关重启中。'),
			submit: function() { return api.telegramAdd(tok); },
			pollLog: function() { return api.telegramAddLog(); },
			onLog: function(d) { self.tgLog.style.display = ''; ocui.setLog(self.tgLog, d.log || _('等待输出...')); },
			onDone: function(ok) { if (ok) self.tgToken.value = ''; self.refreshChannels(); }
		});
	},

	pairTelegram: function() {
		var self = this;
		var code = (this.tgCode.value || '').trim();
		if (!/^[A-Za-z0-9]{4,16}$/.test(code)) {
			ocui.setStatus(this.tgStatus, 'error', _('配对码格式无效'));
			ocui.hideStatusLater(this.tgStatus);
			return;
		}
		return ocui.runOp(this.tgStatus, {
			running: _('「审批配对」命令已提交'),
			success: _('配对已审批，该用户已获授权。'),
			submit: function() { return api.telegramPair(code); },
			onDone: function(ok) { if (ok) self.tgCode.value = ''; }
		});
	},

	listTelegramPairing: function() {
		var self = this;
		return api.telegramPairingList().then(function(r) {
			if (!r.ok) { ocui.setStatus(self.tgStatus, 'error', r.message || _('读取待配对失败')); ocui.hideStatusLater(self.tgStatus); return; }
			var reqs = ((r.data || {}).requests) || [];
			if (!reqs.length) { ocui.setStatus(self.tgStatus, 'success', _('暂无待配对请求。请先用 Telegram 给 Bot 发条私信。')); ocui.hideStatusLater(self.tgStatus); return; }
			self.tgLog.style.display = '';
			ocui.setLog(self.tgLog, reqs.map(function(x) {
				var c = x.code || x.pairingCode || '';
				var who = x.sender || x.from || x.senderId || x.user || '';
				return (c ? c : JSON.stringify(x)) + (who ? '  ←  ' + who : '');
			}).join('\n'));
			ocui.setStatus(self.tgStatus, 'success', _('共 %s 条待配对，复制配对码到上方填入审批。').format(reqs.length));
			ocui.hideStatusLater(self.tgStatus);
		}).catch(function(e) { ocui.setStatus(self.tgStatus, 'error', String(e && e.message || e)); });
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
				ocui.setLog(self.wxLog, self.cleanWechatLog(d.log) || _('等待输出...'));
			},
			onDone: function() { self.refreshWechat(); }
		});
	},

	refreshWechat: function() {
		return api.wechatStatus().then(L.bind(function(result) {
			if (!result.ok) return;
			var d = result.data || {};
			this.wxPlugin.textContent = d.plugin_installed ? _('已安装') + (d.plugin_version ? ' v' + d.plugin_version : '') : _('未安装');
			this.wxLogin.textContent = d.logged_in ? _('已登录') : _('未登录');
			dom.content(this.wxAccounts, (d.accounts || []).length ? d.accounts.map(L.bind(function(account) {
				return E('div', { 'class': 'oc-field' }, [
					E('span', {}, account.name || account.id),
					button(_('退出'), 'cbi-button-negative', L.bind(function() {
						if (!confirm(_('确定退出此微信账号？'))) return;
						return ocui.runOp(this.wxStatus, { running: _('正在退出账号...'), success: _('账号已退出。'), submit: function() { return api.wechatLogout(account.id); }, onDone: L.bind(this.refreshWechat, this) });
					}, this))
				]);
			}, this)) : [ E('p', { 'class': 'oc-muted' }, _('暂无已登录账号')) ]);
		}, this));
	},

	// 从登录输出里提取字符二维码块(去 ANSI; 只留块字符行), 没有则返回去 ANSI 的全文。
	extractWechatQr: function(s) {
		s = (s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
		var lines = s.split('\n'), qr = [];
		for (var i = 0; i < lines.length; i++)
			if (/^[▀-▟\s]+$/.test(lines[i]) && lines[i].replace(/\s/g, '').length > 8) qr.push(lines[i]);
		return qr.length ? qr.join('\n') : s;
	},

	showWechatLogin: function() {
		var qrEl = E('pre', { 'class': 'oc-qr' }, _('正在启动登录，请稍候...'));
		var urlEl = E('p', { 'style': 'display:none; font-size:.85em; margin:.6rem 0 0; word-break:break-all' });
		var fn = L.bind(function() {
			return api.wechatLoginStatus().then(L.bind(function(result) {
				var d = result.data || {};
				var qr = this.extractWechatQr(d.qrcode || d.log || '');
				if (qr.trim()) qrEl.textContent = qr;
				if (d.qrcode_url) {
					urlEl.style.display = '';
					dom.content(urlEl, [ _('无法扫码？点击访问：'), E('a', { href: d.qrcode_url, target: '_blank', rel: 'noopener' }, d.qrcode_url) ]);
				}
				if (d.state === 'success' || d.state === 'failed') { poll.remove(fn); this.refreshWechat(); }
			}, this));
		}, this);
		return api.wechatLogin().then(L.bind(function(result) {
			notify(result);
			if (!result.ok) return;
			ui.showModal(_('微信扫码登录'), [ qrEl, urlEl, E('div', { 'class': 'right' }, [
				closeButton(_('关闭'), function() { poll.remove(fn); api.wechatLoginCancel(); })
			]) ]);
			poll.add(fn, 2);
			fn();
		}, this));
	},

	refreshChannels: function() {
		return api.channelsList().then(L.bind(function(result) {
			var d = result.data || {};
			var chat = d.chat || {};
			var names = Object.keys(chat);
			if (!names.length) {
				dom.content(this.channelBox, E('p', { 'class': 'oc-muted' }, result.ok ? _('尚未配置任何渠道，请用下方向导配置。') : (result.message || _('读取渠道失败'))));
				return;
			}
			var rows = names.map(function(name) {
				var c = chat[name] || {};
				var accounts = (c.accounts || []).length;
				var stateBadge = E('span', { 'class': 'oc-badge oc-ok' }, accounts ? _('已登录 %s 个').format(accounts) : _('已配置'));
				return E('tr', {}, [ E('td', {}, name), E('td', {}, stateBadge), E('td', {}, c.origin || '-') ]);
			});
			dom.content(this.channelBox, E('table', { 'class': 'oc-table' }, [
				E('tr', {}, [ E('th', {}, _('渠道')), E('th', {}, _('状态')), E('th', {}, _('来源')) ])
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
		this.logBox = E('pre', { 'class': 'oc-log' }, _('点击「加载日志」获取最新日志。'));
		return E('div', {}, [
			E('div', { 'class': 'oc-card' }, [
				E('div', { 'class': 'oc-card-title' }, _('网关日志')),
				E('div', { 'class': 'oc-card-body' }, [
					E('div', { 'class': 'oc-actions', 'style': 'align-items:center' }, [
						E('span', {}, _('行数')), this.logLines,
						button(_('加载日志'), 'cbi-button-action', L.bind(this.refreshLogs, this)),
						button(_('清空'), '', L.bind(function() {
							if (this._logPoll) poll.remove(this._logPoll);
							this.logAuto.checked = false;
							this.logBox.textContent = _('点击「加载日志」获取最新日志。');
						}, this)),
						E('label', { 'style': 'display:flex;align-items:center;gap:.35rem' }, [ this.logAuto, _('自动刷新 (2s)') ])
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
				this.logBox.textContent = result.ok ? _('暂无日志（网关可能未运行）。') : (result.message || _('读取日志失败'));
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
				if (this.logBox) this.logBox.textContent = _('点击「加载日志」获取最新日志。');
			}
		}
		this._activeTab = name;
		for (var i = 0; i < tabs.length; i++) {
			var active = tabs[i].name === name;
			tabs[i].panel.style.display = active ? '' : 'none';
			tabs[i].btn.classList.toggle('oc-tab-active', active);
		}
		if (name === 'provider' && !this._providerLoaded) { this._providerLoaded = true; this.refreshProviders(); }
		if (name === 'channel') {
			if (!this._channelLoaded) { this._channelLoaded = true; this.refreshChannels(); this.refreshWechat(); }
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
				E('link', { rel: 'stylesheet', href: L.resource('openclaw/openclaw.css') }),
				E('div', { 'class': 'oc-header' }, [ E('h2', {}, _('配置管理')) ]),
				E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-body' }, [
					E('p', { 'class': 'oc-badge oc-error' }, _('OpenClaw 运行环境未安装，请先在「基本设置」中安装运行环境。'))
				]) ])
			]);
		}

		this.tabDefs = [
			{ name: 'wizard', label: _('官方配置'), panel: this.renderWizardTab() },
			{ name: 'provider', label: _('提供商'), panel: this.renderProviderTab() },
			{ name: 'channel', label: _('渠道'), panel: this.renderChannelTab() },
			{ name: 'health', label: _('健康检查'), panel: this.renderHealthTab() },
			{ name: 'log', label: _('日志'), panel: this.renderLogTab() }
		];

		var self = this;
		var tabBar = E('div', { 'class': 'oc-tabs' }, this.tabDefs.map(function(t) {
			t.btn = E('button', { 'type': 'button', 'class': 'oc-tab' }, t.label);
			t.btn.addEventListener('click', function() { self.switchTab(t.name); });
			t.panel.style.display = 'none';
			return t.btn;
		}));

		var page = E('div', {}, [
			E('link', { rel: 'stylesheet', href: L.resource('openclaw/openclaw.css') }),
			E('div', { 'class': 'oc-header' }, [
				E('h2', {}, _('配置管理')),
				E('p', { 'class': 'oc-muted' }, _('图形化调用 OpenClaw 官方命令行：健康检查、医生修复、提供商与渠道配置、日志查询。'))
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
