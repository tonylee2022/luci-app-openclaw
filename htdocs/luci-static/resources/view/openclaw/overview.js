'use strict';
'require view';
'require poll';
'require ui';
'require dom';
'require openclaw.api as api';
'require openclaw.ui as ocui';

function button(label, css, handler) {
	var btn = E('button', { 'type': 'button', 'class': 'cbi-button ' + css }, label);
	btn.addEventListener('click', function(ev) {
		ev.preventDefault();
		ev.stopPropagation();
		if (btn.disabled) return;
		btn.disabled = true;
		btn.classList.add('oc-btn-loading');
		Promise.resolve().then(function() { return handler(ev); }).catch(function(err) {
			console.error('[openclaw]', err);
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

return view.extend({
	load: function() {
		return Promise.all([ api.status(), api.backupList(), api.setupLog(), api.uninstallLog() ]);
	},

	updateStatus: function() {
		return api.status().then(L.bind(function(result) {
			if (!result.ok) return null;
			var d = result.data || {};
			var values = {
				state: d.gateway_running ? _('运行中') : d.gateway_starting ? _('启动中') : d.gateway_failed ? _('启动失败') : _('已停止'),
				autostart: d.enabled === '1' ? _('是') : _('否'),
				gateway: d.gateway_running ? _('监听端口 %s').format(d.port) : _('未监听'),
				pty: d.pty_running ? _('监听端口 %s').format(d.pty_port) : _('未监听'),
				model: d.active_model || _('未配置'), channels: d.channels || _('未配置'), pid: d.pid || '-',
				memory: d.memory_kb ? (d.memory_kb / 1024).toFixed(1) + ' MB' : '-', node: d.node_version || _('未安装'),
				openclaw: d.oc_version || _('未安装'), plugin: d.plugin_version || '-', path: d.install_path || '-', disk: d.disk_free || '-'
			};
			Object.keys(values).forEach(function(key) { var el = document.getElementById('oc-' + key); if (el) el.textContent = values[key]; });
			this._enabled = d.enabled;
			if (d.stable_version) this._stableVersion = d.stable_version;
			if (this.autostartBtn) this.autostartBtn.textContent = (d.enabled === '1') ? _('禁用自启') : _('启用自启');
			var badge = document.getElementById('oc-state');
			// 复用按钮配色: 运行中=positive(绿), 启动中=自定义琥珀, 其余=negative(红); 圆角见 oc-state-badge
			if (badge) {
				var variant = d.gateway_running ? 'oc-state-run' : d.gateway_starting ? 'oc-state-starting' : 'oc-state-stop';
				badge.className = 'cbi-button ' + variant + ' oc-state-badge';
			}
			return d;
		}, this));
	},

	updateTaskPanel: function(title, result) {
		if (!this.taskPanel || !result)
			return;
		var data = result.data || {};
		this.taskPanel.style.display = '';
		this.taskTitle.textContent = title;
		ocui.setLog(this.taskLog, data.log || (data.running ? _('任务已启动，等待输出...') : _('暂无任务输出')));
		if (!result.ok) {
			this.taskState.className = 'oc-task-state oc-task-error';
			this.taskState.textContent = result.message || _('无法读取任务状态');
			this.taskClose.style.display = '';
		}
		else if (data.running) {
			this.taskState.className = 'oc-task-state oc-task-running';
			this.taskState.textContent = _('任务正在运行，请不要关闭路由器电源。');
			this.taskClose.style.display = 'none';
		}
		else if (data.done) {
			var ok = data.exit_code === 0;
			this.taskState.className = 'oc-task-state ' + (ok ? 'oc-task-success' : 'oc-task-error');
			if (ok && title === _('安装运行环境'))
				this.taskState.textContent = _('安装完成！请刷新页面后点击「启动」按钮启动服务。');
			else
				this.taskState.textContent = ok ? _('任务已完成。') : _('任务失败，退出码：%s').format(data.exit_code);
			this.taskClose.style.display = '';
			this.updateStatus();
		}
	},

	showAcceptedTask: function(title, message) {
		ui.hideModal();
		this.taskPanel.style.display = '';
		this.taskTitle.textContent = title;
		this.taskState.className = 'oc-task-state oc-task-running';
		this.taskState.textContent = _('任务正在运行，请不要关闭路由器电源。');
		this.taskLog.textContent = message;
		this.taskClose.style.display = 'none';
		window.setTimeout(L.bind(function() {
			this.taskPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}, this), 100);
		this.pollTasks();
	},

	pollTasks: function() {
		return Promise.all([ api.setupLog(), api.uninstallLog(), api.upgradeLog() ]).then(L.bind(function(results) {
			var tasks = [
				{ title: _('安装运行环境'), result: results[0] },
				{ title: _('卸载运行环境'), result: results[1] },
				{ title: _('升级 LuCI 插件'), result: results[2] }
			];
			var panelVisible = this.taskPanel && this.taskPanel.style.display !== 'none';
			var selected = null;
			tasks.forEach(function(task) {
				var data = task.result.data || {};
				if (!(data.running || data.done)) return;
				// 已完成的历史任务不在刷新/初次加载时自动弹出；仅当面板已可见(本次操作触发)时才更新到完成态
				if (data.done && !data.running && !panelVisible) return;
				if (!selected || data.running && !(selected.result.data || {}).running || data.running === (selected.result.data || {}).running && (data.updated || 0) > ((selected.result.data || {}).updated || 0))
					selected = task;
			});
			if (selected)
				this.updateTaskPanel(selected.title, selected.result);
		}, this));
	},

	showSetup: function() {
		var stableLabel = this._stableVersion ? _('稳定版 (%s)').format(this._stableVersion) : _('稳定版');
		var version = E('select', { 'class': 'cbi-input-select' }, [ E('option', { value: 'stable' }, stableLabel), E('option', { value: 'latest' }, _('最新版 (latest)')) ]);
		// 挂载点下拉(由 install_targets 填充) + 手动输入(默认隐藏)
		var mountSel = E('select', { 'class': 'cbi-input-select oc-input' }, [ E('option', { value: '' }, _('正在探测挂载点...')) ]);
		var path = E('input', { 'class': 'cbi-input-text oc-input', value: '/opt', 'style': 'display:none' });
		var capacity = E('div', { 'class': 'oc-capacity' }, _('正在检查安装路径容量...'));
		var progress = E('div', { 'class': 'oc-task-state', 'style': 'display:none' }, '');
		var checkedPath = null;
		var checkTimer = null;
		// 当前选定的基路径: 下拉非「手动」时取下拉值, 否则取手动输入框
		var currentBase = function() { return mountSel.value === '__manual__' ? path.value : mountSel.value; };
		var install = button(_('开始安装'), 'cbi-button-positive', L.bind(function() {
			if (!checkedPath || checkedPath !== currentBase()) {
				progress.style.display = '';
				progress.className = 'oc-task-state oc-task-error';
				progress.textContent = _('安装路径已变化，请等待容量检查完成。');
				return;
			}
			install.disabled = true;
			version.disabled = true;
			path.disabled = true;
			progress.style.display = '';
			progress.className = 'oc-task-state oc-task-running';
			progress.textContent = _('正在启动后台安装任务...');
			var submittedAt = Math.floor(Date.now() / 1000);
			return api.setup(version.value, checkedPath).then(L.bind(function(result) {
				if (!result.ok)
					throw new Error(result.message || _('无法启动安装任务'));
				this.showAcceptedTask(_('安装运行环境'), _('安装任务已提交，等待输出...'));
			}, this)).catch(L.bind(function(error) {
				return api.setupLog().then(L.bind(function(status) {
					var data = status.data || {};
					if (status.ok && (data.running || data.done && (data.updated || 0) >= submittedAt - 2)) {
						this.showAcceptedTask(_('安装运行环境'), data.log || _('安装任务已提交，等待输出...'));
						return;
					}
					progress.className = 'oc-task-state oc-task-error';
					progress.textContent = error.message || String(error);
					install.disabled = false;
					version.disabled = false;
					path.disabled = false;
				}, this), L.bind(function() {
					progress.className = 'oc-task-state oc-task-error';
					progress.textContent = error.message || String(error);
					install.disabled = false;
					version.disabled = false;
					path.disabled = false;
				}, this));
			}, this));
		}, this));
		var checkCapacity = L.bind(function() {
			checkedPath = null;
			install.disabled = true;
			capacity.className = 'oc-capacity oc-capacity-checking';
			capacity.textContent = _('正在检查安装路径容量和写入权限...');
			return api.installPathProbe(currentBase()).then(function(result) {
				var d = result.data || {};
				dom.content(capacity, [
					E('div', { 'class': 'oc-capacity-title' }, result.ok ? _('安装条件检查通过') : _('安装条件检查未通过')),
					E('div', { 'class': 'oc-capacity-grid' }, [
						E('span', {}, _('实际路径')), E('strong', {}, (d.install_path || currentBase()) + '/openclaw'),
						E('span', {}, _('检测挂载点')), E('strong', {}, d.disk_path || '-'),
						E('span', {}, _('磁盘总容量')), E('strong', {}, d.disk_total_str || (d.disk_total_mb ? d.disk_total_mb + ' MB' : '-')),
						E('span', {}, _('磁盘可用容量')), E('strong', {}, (d.disk_free_str || (d.disk_mb ? d.disk_mb + ' MB' : '-')) + ' / ' + _('最低 2 GB')),
						E('span', {}, _('系统内存')), E('strong', {}, (d.memory_mb || 0) + ' MB / ' + _('最低 1024 MB')),
						E('span', {}, _('路径写入权限')), E('strong', {}, d.writable_ok ? _('可写') : _('不可写'))
					])
				]);
				capacity.className = 'oc-capacity ' + (result.ok ? 'oc-capacity-ok' : 'oc-capacity-error');
				if (result.ok) {
					checkedPath = currentBase();
					install.disabled = false;
				}
			}).catch(function(error) {
				capacity.className = 'oc-capacity oc-capacity-error';
				capacity.textContent = error.message || String(error);
			});
		}, this);
		// 选择挂载点 → 切换手动输入显隐, 重新检查容量
		mountSel.addEventListener('change', function() {
			path.style.display = (mountSel.value === '__manual__') ? '' : 'none';
			checkCapacity();
		});
		// 手动输入(防抖), 不回写、不强制前缀
		path.addEventListener('input', function() {
			window.clearTimeout(checkTimer);
			checkTimer = window.setTimeout(checkCapacity, 500);
		});
		ui.showModal(_('安装运行环境'), [
			E('p', {}, _('安装程序会在所选挂载点下创建 openclaw 目录。请选择有足够空间（≥2GB）的磁盘挂载点。')),
			E('div', { 'class': 'oc-form-row' }, [ E('label', {}, _('版本')), version ]),
			E('div', { 'class': 'oc-form-row' }, [ E('label', {}, _('安装位置')), mountSel ]),
			E('div', { 'class': 'oc-form-row' }, [ E('label', {}, _('自定义路径')), path ]),
			capacity,
			progress,
			E('div', { 'class': 'right' }, [ closeButton(_('关闭')), install ])
		]);
		// 探测挂载点填充下拉, 默认选可用空间最大的(满足≥2GB)
		api.installTargets().then(function(result) {
			var targets = ((result.data || {}).targets || []).slice().sort(function(a, b) { return (b.avail_mb || 0) - (a.avail_mb || 0); });
			var opts = targets.map(function(t) {
				return E('option', { value: t.path }, t.path + '  (' + _('可用') + ' ' + (t.free_str || '?') + ' / ' + (t.total_str || '?') + ', ' + t.fstype + ')' + (t.enough ? '' : ' ⚠'));
			});
			opts.push(E('option', { value: '__manual__' }, _('手动输入其他路径…')));
			dom.content(mountSel, opts);
			// 默认: 优先 /opt(若空间足够, 符合惯例), 否则选可用空间最大且足够的, 再否则最大
			var enoughList = targets.filter(function(t) { return t.enough; });
			var def = enoughList.filter(function(t) { return t.path === '/opt'; })[0] || enoughList[0] || targets[0];
			mountSel.value = def ? def.path : '__manual__';
			path.style.display = (mountSel.value === '__manual__') ? '' : 'none';
			checkCapacity();
		}).catch(function() {
			// 探测失败兜底: 仅手动输入
			dom.content(mountSel, [ E('option', { value: '__manual__' }, _('手动输入路径')) ]);
			mountSel.value = '__manual__';
			path.style.display = '';
			checkCapacity();
		});
	},

	uninstall: function() {
		if (!confirm(_('将删除 OpenClaw 运行环境和数据，确定继续？')))
			return;
		return ocui.runOp(this.actionStatus, {
			running: _('「卸载环境」命令已提交'),
			success: _('运行环境已卸载。'),
			submit: function() { return api.uninstall(); },
			cancel: function() { return api.taskCancel('openclaw-uninstall'); },
			onClose: L.bind(function() { if (this.taskPanel) this.taskPanel.style.display = 'none'; }, this),
			pollLog: function() { return api.uninstallLog(); },
			onLog: L.bind(function(d) { this.updateTaskPanel(_('卸载运行环境'), { ok: true, data: d }); }, this),
			onDone: L.bind(function() { this.updateStatus(); }, this)
		});
	},

	checkUpgrade: function() {
		var self = this;
		return api.updateCheck().then(L.bind(function(result) {
			if (!result.ok) {
				ocui.setStatus(self.actionStatus, 'error', result.message || _('检测失败'));
				return;
			}
			if (!result.data.plugin_has_update) {
				ocui.setStatus(self.actionStatus, 'success', _('当前已是最新版本（%s）').format(result.data.plugin_current));
				ocui.hideStatusLater(self.actionStatus);
				return;
			}
			if (!confirm(_('发现新版本 %s（当前 %s），立即升级？').format(result.data.plugin_latest, result.data.plugin_current)))
				return;
			var version = result.data.plugin_latest;
			return ocui.runOp(this.actionStatus, {
				running: _('正在升级 LuCI 插件...'),
				success: _('插件升级完成。'),
				submit: function() { return api.upgrade(version); },
				cancel: function() { return api.taskCancel('openclaw-plugin-upgrade'); },
				onClose: L.bind(function() { if (this.taskPanel) this.taskPanel.style.display = 'none'; }, this),
				pollLog: function() { return api.upgradeLog(); },
				onLog: L.bind(function(d) { self.updateTaskPanel(_('升级 LuCI 插件'), { ok: true, data: d }); }, self),
				onDone: function(ok) {
					if (!ok) return;
					if (!confirm(_('插件升级完成！\n\n后端服务（rpcd）需要重启才能加载新版本，重启后需要重新登录 LuCI。\n\n是否立即重启后端服务？')))
						return;
					ocui.setStatus(self.actionStatus, 'running', _('正在重启后端服务...'));
					api.rpcdRestart();
				}
			});
		}, this));
	},

	// 切换开机自启: 改 uci openclaw.main.enabled (init.d 总开关) + 同步 rc.d 软链; 不启停当前进程。
	toggleAutostart: function() {
		var on = (this._enabled !== '1');
		return ocui.runOp(this.actionStatus, {
			running: _('「%s」命令已提交').format(on ? _('启用自启') : _('禁用自启')),
			success: on ? _('已启用开机自启。') : _('已禁用开机自启（当前进程不受影响）。'),
			submit: function() { return api.autostartSet(on ? '1' : '0'); },
			onDone: L.bind(function() { this.updateStatus(); }, this)
		});
	},

	serviceAction: function(action) {
		return api.serviceAction(action).then(L.bind(function(result) {
			if (!result.ok) {
				ocui.setStatus(this.actionStatus, 'error', result.message || _('操作失败'));
				return;
			}
			// 信息栏已由按钮包装显示「XX命令已提交」, 此处直接进入等待/刷新
			// enable/disable 立即生效，刷新一次即可
			if (action === 'enable' || action === 'disable') {
				return new Promise(function(resolve) { window.setTimeout(resolve, 600); })
					.then(L.bind(this.updateStatus, this))
					.then(L.bind(function() {
						this.actionStatus.className = 'oc-action-status oc-task-success';
						this.actionStatus.textContent = _('操作成功');
						this.hideActionStatusLater();
					}, this));
			}
			// 启动/重启/仅重启网关 → 等待网关运行；停止 → 等待网关停止
			var expectRunning = (action === 'start' || action === 'restart' || action === 'restart_gateway');
			return this.waitForGateway(expectRunning);
		}, this));
	},

	hideActionStatusLater: function() {
		window.clearTimeout(this._actionStatusTimer);
		this._actionStatusTimer = window.setTimeout(L.bind(function() {
			this.actionStatus.style.display = 'none';
		}, this), 4000);
	},

	waitForGateway: function(expectRunning) {
		poll.stop();
		var self = this;
		var start = Date.now();
		var timeoutMs = 40000, stepMs = 1500;
		function done() { poll.start(); }
		function tick() {
			return self.updateStatus().then(function(d) {
				d = d || {};
				var running = (d.gateway_running === true);
				var starting = (d.gateway_starting === true);
				var failed = (d.gateway_failed === true);
				if (expectRunning) {
					if (running) {
						done();
						self.actionStatus.className = 'oc-action-status oc-task-success';
						self.actionStatus.textContent = _('网关已就绪，运行中。');
						self.hideActionStatusLater();
						return;
					}
					if (failed) {
						done();
						self.actionStatus.className = 'oc-action-status oc-task-error';
						self.actionStatus.textContent = _('网关启动失败，请在日志中排查。');
						return;
					}
				}
				else {
					if (!running && !starting) {
						done();
						self.actionStatus.className = 'oc-action-status oc-task-success';
						self.actionStatus.textContent = _('网关已停止。');
						self.hideActionStatusLater();
						return;
					}
				}
				if (Date.now() - start > timeoutMs) {
					done();
					self.actionStatus.className = 'oc-action-status oc-task-error';
					self.actionStatus.textContent = _('操作超时，网关未在预期时间内就绪，请稍后刷新查看。');
					return;
				}
				// 进行中: 徽章跟随后台真实相位（重启=停止中→启动中，停止=停止中）
				var badgeVariant, badgeText, statusText;
				if (!expectRunning || !starting) {
					badgeVariant = 'oc-state-stopping'; badgeText = _('停止中');
					statusText = expectRunning ? _('正在重启网关，等待停止...') : _('正在停止网关...');
				} else {
					badgeVariant = 'oc-state-starting'; badgeText = _('启动中');
					statusText = _('网关启动中，请稍候...');
				}
				self.actionStatus.className = 'oc-action-status oc-task-running';
				self.actionStatus.textContent = statusText;
				var badge = document.getElementById('oc-state');
				if (badge) {
					badge.textContent = badgeText;
					badge.className = 'cbi-button ' + badgeVariant + ' oc-state-badge';
				}
				return new Promise(function(resolve) { window.setTimeout(resolve, stepMs); }).then(tick);
			});
		}
		return tick().catch(function(e) { done(); throw e; });
	},

	showEnvUpgrade: function() {
		var status = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		var log = E('pre', { 'class': 'oc-log', 'style': 'display:none' }, '');
		var nodeVer = E('input', { 'class': 'cbi-input-text', 'value': '22.22.3', 'style': 'width:9rem' });
		var run = function(label, submitFn) {
			return ocui.runOp(status, {
				running: _('「%s」命令已提交').format(label),
				success: _('%s完成。').format(label),
				submit: submitFn,
				pollLog: function() { return api.envUpgradeLog(); },
				onLog: function(d) { log.style.display = ''; ocui.setLog(log, d.log || _('等待输出...')); }
			});
		};
		ui.showModal(_('环境升级'), [
			E('p', { 'class': 'oc-muted' }, _('升级运行环境组件。升级 OpenClaw / Node 会自动重启网关使其生效；升级 Node 请填写目标版本号（如 22.22.3）。')),
			E('div', { 'class': 'oc-actions' }, [
				button(_('升级 OpenClaw 最新版'), 'cbi-button-positive', function() { return run(_('升级 OpenClaw'), function() { return api.envUpgradeOpenclaw(); }); }),
				button(_('升级 npm 最新版'), 'cbi-button-action', function() { return run(_('升级 npm'), function() { return api.envUpgradeNpm(); }); })
			]),
			E('div', { 'class': 'oc-field', 'style': 'margin-top:.5rem;align-items:center' }, [
				E('span', {}, _('Node 版本')),
				E('span', { 'class': 'oc-value' }, [ nodeVer, ' ', button(_('升级 Node'), 'cbi-button-action', function() { return run(_('升级 Node'), function() { return api.envUpgradeNode(nodeVer.value); }); }) ])
			]),
			status, log,
			E('div', { 'class': 'right' }, [ closeButton(_('关闭')) ])
		]);
	},

	showBackups: function() {
		var body = E('div', {}, _('加载中...'));
		var bkStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		var refresh = L.bind(function() {
			return api.backupList().then(L.bind(function(result) {
				var info = result.data || {};
				var pathInput = E('input', { type: 'text', 'class': 'cbi-input-text', style: 'width:20em;max-width:60%', value: info.backup_custom ? (info.backup_dir || '') : '', placeholder: info.backup_default || '' });
				var pathRow = E('div', { 'class': 'oc-backup-path' }, [
					E('div', { 'class': 'oc-hint' }, _('备份保存目录（位于安装目录之外，卸载环境不会删除）：') + ' ' + (info.backup_dir || '-')),
					E('div', { 'class': 'oc-actions', style: 'margin-top:6px' }, [
						pathInput,
						button(_('保存路径'), 'cbi-button-action', function() { var v = (pathInput.value || '').replace(/^\s+|\s+$/g, ''); return ocui.runOp(bkStatus, { running: _('正在更新备份路径...'), success: _('备份路径已更新。'), submit: function() { return api.backupPathSet(v); }, onDone: refresh }); }),
						info.backup_custom ? button(_('恢复默认'), '', function() { return ocui.runOp(bkStatus, { running: _('正在恢复默认路径...'), success: _('已恢复默认备份路径。'), submit: function() { return api.backupPathSet(''); }, onDone: refresh }); }) : E('span')
					])
				]);
				var rows = (result.data.backups || []).map(L.bind(function(item) {
					return E('tr', {}, [ E('td', {}, item.backup_type === 'config' ? _('仅配置') : _('完整')), E('td', {}, item.time || item.filename), E('td', {}, item.size_str), E('td', { 'class': 'oc-table-actions' }, [
						button(_('验证'), '', function() { return ocui.runOp(bkStatus, { running: _('正在验证备份...'), success: _('备份验证通过。'), submit: function() { return api.backupVerify(item.filename); } }); }),
						button(_('恢复'), 'cbi-button-action', function() { if (!confirm(_('恢复会覆盖当前状态并重启服务，确定继续？'))) return; return ocui.runOp(bkStatus, { running: _('正在恢复备份...'), success: _('备份已恢复，服务重启中。'), submit: function() { return api.backupRestore(item.filename); }, onDone: refresh }); }),
						button(_('删除'), 'cbi-button-negative', function() { if (!confirm(_('确定删除此备份？'))) return; return ocui.runOp(bkStatus, { running: _('正在删除备份...'), success: _('备份已删除。'), submit: function() { return api.backupDelete(item.filename); }, onDone: refresh }); })
					]) ]);
				}, this));
				dom.content(body, [ E('div', { 'class': 'oc-actions' }, [
					button(_('创建配置备份'), 'cbi-button-positive', function() { return ocui.runOp(bkStatus, { running: _('正在创建配置备份...'), success: _('配置备份已创建。'), submit: function() { return api.backupCreate(true); }, onDone: refresh }); }),
					button(_('创建完整备份'), 'cbi-button-action', function() { return ocui.runOp(bkStatus, { running: _('正在创建完整备份...'), success: _('完整备份已创建。'), submit: function() { return api.backupCreate(false); }, onDone: refresh }); })
				]), bkStatus, pathRow, E('table', { 'class': 'oc-table' }, [ E('tr', {}, [ E('th', {}, _('类型')), E('th', {}, _('时间/文件')), E('th', {}, _('大小')), E('th', {}, _('操作')) ]) ].concat(rows)) ]);
			}, this));
		}, this);
		ui.showModal(_('备份与恢复'), [ body, E('div', { 'class': 'right' }, [ closeButton(_('关闭')) ]) ]);
		refresh();
	},

	render: function(data) {
		var self = this;
		this._stableVersion = ((data[0] || {}).data || {}).stable_version || '';
		ocui.applyTheme();
		var ghLink = E('a', { href: 'https://github.com/tonylee2022/luci-app-openclaw', target: '_blank', rel: 'noopener', 'class': 'oc-gh' });
		ghLink.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg><span>github.com/tonylee2022/luci-app-openclaw</span>';
		var statusGroups = [
			{ label: _('服务'), fields: [ ['state', _('状态'), 'cbi-button oc-state-run oc-state-badge'], ['autostart', _('开机自启')], ['gateway', _('网关')], ['pty', _('配置终端')], ['model', _('活跃模型')], ['channels', _('消息渠道')] ] },
			{ label: '', fields: [ ['pid', _('PID')], ['memory', _('内存')] ] },
			{ label: '', fields: [ ['node', _('Node.js')], ['openclaw', _('OpenClaw 版本')], ['plugin', _('插件版本')], ['path', _('安装路径')], ['disk', _('剩余空间')] ] }
		];
		// 开机自启切换按钮: 移到快捷操作栏; 标签随状态在 updateStatus 更新
		this.autostartBtn = button(_('切换开机自启'), 'cbi-button-action', L.bind(this.toggleAutostart, this));
		var statusItems = [];
		statusGroups.forEach(function(group) {
			if (group.label)
				statusItems.push(E('div', { 'class': 'oc-section-label' }, group.label));
			group.fields.forEach(function(f) {
				statusItems.push(E('div', { 'class': 'oc-field' }, [ E('span', {}, f[1]), E('span', { 'class': 'oc-value' }, [ E('span', { id: 'oc-' + f[0], 'class': f[2] || '' }, '-') ]) ]));
			});
		});
		// 操作按钮包装: 点击即在信息栏提示「XX命令已提交」
		var act = function(label, css, handler) {
			return button(label, css, function(ev) {
				ocui.setStatus(self.actionStatus, 'running', _('「%s」命令已提交').format(label));
				return handler(ev);
			});
		};
		var actions = E('div', { 'class': 'oc-actions' }, [
			button(_('安装运行环境'), 'cbi-button-positive', L.bind(this.showSetup, this)),
			act(_('启动'), 'cbi-button-action', L.bind(this.serviceAction, this, 'start')),
			act(_('重启'), 'cbi-button-action', L.bind(this.serviceAction, this, 'restart')),
			act(_('仅重启网关'), 'cbi-button-action', L.bind(this.serviceAction, this, 'restart_gateway')),
			act(_('停止'), 'oc-btn-amber', L.bind(this.serviceAction, this, 'stop')),
			this.autostartBtn,
			act(_('检测升级'), 'cbi-button-action', L.bind(this.checkUpgrade, this)),
			button(_('环境升级'), 'cbi-button-action', L.bind(this.showEnvUpgrade, this)),
			button(_('备份/恢复'), 'cbi-button-action', L.bind(this.showBackups, this)),
			act(_('卸载环境'), 'cbi-button-negative', L.bind(this.uninstall, this))
		]);
		this.actionStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.taskTitle = E('span', {}, _('系统任务'));
		this.taskClose = E('button', { 'type': 'button', 'class': 'cbi-button', 'style': 'display:none' }, _('关闭'));
		this.taskClose.addEventListener('click', L.bind(function() { this.taskPanel.style.display = 'none'; }, this));
		this.taskState = E('div', { 'class': 'oc-task-state' }, _('暂无运行中的任务。'));
		this.taskLog = E('pre', { 'class': 'oc-log' }, '');
		this.taskPanel = E('div', { 'class': 'oc-card', 'style': 'display:none' }, [ E('div', { 'class': 'oc-card-title oc-task-title' }, [ this.taskTitle, this.taskClose ]), E('div', { 'class': 'oc-card-body' }, [ E('div', { 'class': 'oc-task-wrap' }, [ this.taskState, this.taskLog ]) ]) ]);
		var page = E('div', {}, [ E('link', { rel: 'stylesheet', href: L.resource('openclaw/openclaw.css') }), E('div', { 'class': 'oc-header' }, [ E('h2', {}, _('OpenClaw AI 网关')), E('p', { 'class': 'oc-muted' }, _('管理 OpenClaw 运行环境、procd 服务、升级和备份。')) ]), E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-title' }, _('状态概览')), E('div', { 'class': 'oc-card-body' }, [ E('div', { 'class': 'oc-status-list' }, statusItems) ]) ]), E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-title' }, _('快捷操作')), E('div', { 'class': 'oc-card-body' }, [ actions, this.actionStatus ]) ]), this.taskPanel,
			E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-title' }, _('快速指南')), E('div', { 'class': 'oc-card-body' }, [ E('ol', { 'class': 'oc-guide' }, [
				E('li', {}, _('首次使用：先点「安装运行环境」，装好后到「配置管理 → 官方配置」或 openclaw-shell 配置模型/渠道。')),
				E('li', {}, _('配置改动后点「重启」或「重启网关」使其生效；状态徽标显示「运行中」即正常。')),
				E('li', {}, _('微信 / Telegram 在「配置管理 → 渠道」配置；遇问题用「配置管理 → 健康检查」或 openclaw doctor 排查。'))
			]), E('p', { 'class': 'oc-muted', 'style': 'margin:.7rem 0 0; text-align:right' }, [ _('项目主页 / 反馈：'), ghLink ]) ]) ]) ]);
		window.setTimeout(L.bind(this.updateStatus, this), 0);
		window.setTimeout(L.bind(this.pollTasks, this), 0);
		poll.add(L.bind(this.updateStatus, this), 10);
		poll.add(L.bind(this.pollTasks, this), 2);
		return page;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
