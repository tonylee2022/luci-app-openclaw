'use strict';
'require view';
'require poll';
'require ui';
'require dom';
'require openclaw.api as api';
'require openclaw.ui as ocui';

return view.extend({
	load: function() {
		return Promise.all([ api.status(), api.backupList(), api.setupLog(), api.uninstallLog() ]);
	},

	updateStatus: function() {
		return api.status().then(L.bind(function(result) {
			if (!result.ok) return null;
			var d = result.data || {};
			var values = {
				state: d.gateway_running ? _('Running') : d.gateway_starting ? _('Starting') : d.gateway_failed ? _('Start failed') : _('Stopped'),
				autostart: d.enabled === '1' ? _('Yes') : _('No'),
				gateway: d.gateway_running ? _('Listening on port %s').format(d.port) : _('Not listening'),
				model: d.active_model || _('Not configured'), channels: d.channels ? d.channels.split(', ').map(function(c) { return _(c); }).join(', ') : _('Not configured'), pid: d.pid || '-',
				memory: d.memory_kb ? (d.memory_kb / 1024).toFixed(1) + ' MB' : '-', node: d.node_version || _('Not installed'),
				openclaw: d.oc_version || _('Not installed'), plugin: d.plugin_version || '-', path: d.oc_version ? (d.install_path || '-') : '-', node_path: d.node_version ? (d.node_path || '-') : '-', disk: d.disk_free || '-'
			};
			Object.keys(values).forEach(function(key) { var el = document.getElementById('oc-' + key); if (el) el.textContent = values[key]; });
			this._enabled = d.enabled;
			if (d.stable_version) this._stableVersion = d.stable_version;
			if (this.autostartBtn) this.autostartBtn.textContent = (d.enabled === '1') ? _('Disable autostart') : _('Enable autostart');
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
		ocui.setLog(this.taskLog, data.log || (data.running ? _('Task started, waiting for output...') : _('No task output yet')));
		if (!result.ok) {
			this.taskState.className = 'oc-task-state oc-task-error';
			this.taskState.textContent = _(result.message || 'Failed to read task status');
			this.taskClose.style.display = '';
		}
		else if (data.running) {
			this.taskState.className = 'oc-task-state oc-task-running';
			this.taskState.textContent = _('Task running, do not power off the router.');
			this.taskClose.style.display = 'none';
		}
		else if (data.done) {
			var ok = data.exit_code === 0;
			this.taskState.className = 'oc-task-state ' + (ok ? 'oc-task-success' : 'oc-task-error');
			if (ok && title === _('Install runtime'))
				this.taskState.textContent = _('Installation complete! The service is enabled; refresh the page to see status.');
			else
				this.taskState.textContent = ok ? _('Task completed.') : _('Task failed, exit code: %s').format(data.exit_code);
			this.taskClose.style.display = '';
			this.updateStatus();
		}
	},

	showAcceptedTask: function(title, message) {
		ui.hideModal();
		this.taskPanel.style.display = '';
		this.taskTitle.textContent = title;
		this.taskState.className = 'oc-task-state oc-task-running';
		this.taskState.textContent = _('Task running, do not power off the router.');
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
				{ title: _('Install runtime'), result: results[0] },
				{ title: _('Uninstall runtime'), result: results[1] },
				{ title: _('Upgrade LuCI app'), result: results[2] }
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
		var stableLabel = this._stableVersion ? _('Stable (%s)').format(this._stableVersion) : _('Stable');
		var version = E('select', { 'class': 'cbi-input-select' }, [ E('option', { value: 'stable' }, stableLabel), E('option', { value: 'latest' }, _('Latest (latest)')) ]);
		// Node.js 版本: 稳定版(默认) / 最新版 / 自定义输入
		var nodeVerSel = E('select', { 'class': 'cbi-input-select oc-input', style: 'width:auto' }, [
			E('option', { value: '22.22.3' }, 'Node 22.22.3'),
			E('option', { value: '24.17.0' }, 'Node 24.17.0'),
			E('option', { value: '__custom__' }, _('Custom version...'))
		]);
		var nodeVerCustom = E('input', {
			'class': 'cbi-input-text oc-input',
			placeholder: 'x.y.z',
			style: 'display:none;width:96px;margin-left:6px'
		});
		var nodeVerHint = E('span', {
			style: 'display:none;color:var(--secondary-text-color,#888);font-size:.85em;margin-left:4px'
		}, _('Format: x.y.z'));
		nodeVerSel.addEventListener('change', function() {
			var custom = nodeVerSel.value === '__custom__';
			nodeVerCustom.style.display = custom ? '' : 'none';
			nodeVerHint.style.display = custom ? '' : 'none';
		});
		var getNodeVer = function() {
			return nodeVerSel.value === '__custom__' ? nodeVerCustom.value.trim() : nodeVerSel.value;
		};
		// 挂载点下拉(由 install_targets 填充) + 手动输入(默认隐藏)
		var mountSel = E('select', { 'class': 'cbi-input-select oc-input' }, [ E('option', { value: '' }, _('Probing mount points...')) ]);
		var path = E('input', { 'class': 'cbi-input-text oc-input', value: '/opt', 'style': 'display:none' });
		var capacity = E('div', { 'class': 'oc-capacity' }, _('Checking install path capacity...'));
		var progress = E('div', { 'class': 'oc-task-state', 'style': 'display:none' }, '');
		var checkedPath = null;
		var checkTimer = null;
		// 当前选定的基路径: 下拉非「手动」时取下拉值, 否则取手动输入框
		var currentBase = function() { return mountSel.value === '__manual__' ? path.value : mountSel.value; };
		var install = ocui.button(_('Start install'), 'cbi-button-positive', L.bind(function() {
			if (!checkedPath || checkedPath !== currentBase()) {
				progress.style.display = '';
				progress.className = 'oc-task-state oc-task-error';
				progress.textContent = _('Install path changed; wait for the capacity check to finish.');
				return;
			}
			var nv = getNodeVer();
			if (nodeVerSel.value === '__custom__' && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(nv)) {
				progress.style.display = '';
				progress.className = 'oc-task-state oc-task-error';
				progress.textContent = _('Invalid Node.js version format, enter x.y.z (e.g. 24.17.0).');
				return;
			}
			install.disabled = true;
			version.disabled = true;
			path.disabled = true;
			progress.style.display = '';
			progress.className = 'oc-task-state oc-task-running';
			progress.textContent = _('Starting background install task...');
			var submittedAt = Math.floor(Date.now() / 1000);
			return api.setup(version.value, checkedPath, nv).then(L.bind(function(result) {
				if (!result.ok)
					throw new Error(_(result.message || 'Failed to start the install task'));
				this.showAcceptedTask(_('Install runtime'), _('Install task submitted, waiting for output...'));
			}, this)).catch(L.bind(function(error) {
				return api.setupLog().then(L.bind(function(status) {
					var data = status.data || {};
					if (status.ok && (data.running || data.done && (data.updated || 0) >= submittedAt - 2)) {
						this.showAcceptedTask(_('Install runtime'), data.log || _('Install task submitted, waiting for output...'));
						return;
					}
					progress.className = 'oc-task-state oc-task-error';
					progress.textContent = _(error.message || String(error));
					install.disabled = false;
					version.disabled = false;
					path.disabled = false;
				}, this), L.bind(function() {
					progress.className = 'oc-task-state oc-task-error';
					progress.textContent = _(error.message || String(error));
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
			capacity.textContent = _('Checking install path capacity and write permission...');
			return api.installPathProbe(currentBase()).then(function(result) {
				var d = result.data || {};
				dom.content(capacity, [
					E('div', { 'class': 'oc-capacity-title' }, result.ok ? _('Install precondition check passed') : _('Install precondition check failed')),
					E('div', { 'class': 'oc-capacity-grid' }, [
						E('span', {}, _('Actual path')), E('strong', {}, (d.install_path || currentBase()) + '/openclaw'),
						E('span', {}, _('Detect mount points')), E('strong', {}, d.disk_path || '-'),
						E('span', {}, _('Disk total space')), E('strong', {}, d.disk_total_str || (d.disk_total_mb ? d.disk_total_mb + ' MB' : '-')),
						E('span', {}, _('Disk free space')), E('strong', {}, (d.disk_free_str || (d.disk_mb ? d.disk_mb + ' MB' : '-')) + ' / ' + _('Minimum 2 GB')),
						E('span', {}, _('System memory')), E('strong', {}, (d.memory_mb || 0) + ' MB / ' + _('Minimum 1024 MB')),
						E('span', {}, _('Path write permission')), E('strong', {}, d.writable_ok ? _('Writable') : _('Not writable'))
					])
				]);
				capacity.className = 'oc-capacity ' + (result.ok ? 'oc-capacity-ok' : 'oc-capacity-error');
				if (result.ok) {
					checkedPath = currentBase();
					install.disabled = false;
				}
			}).catch(function(error) {
				capacity.className = 'oc-capacity oc-capacity-error';
				capacity.textContent = _(error.message || String(error));
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
		ui.showModal(_('Install runtime'), [
			E('p', {}, _('The installer creates an openclaw directory under the selected mount point. Choose a disk mount with enough space (>=2GB).')),
			E('div', { 'class': 'oc-form-row' }, [ E('label', {}, _('Version')), version ]),
			E('div', { 'class': 'oc-form-row' }, [
				E('label', {}, _('Node.js version')),
				E('div', { style: 'display:flex;align-items:center;flex-wrap:wrap;gap:4px' }, [ nodeVerSel, nodeVerCustom, nodeVerHint ])
			]),
			E('div', { 'class': 'oc-form-row' }, [ E('label', {}, _('Install location')), mountSel ]),
			E('div', { 'class': 'oc-form-row' }, [ E('label', {}, _('Custom path')), path ]),
			capacity,
			progress,
			E('div', { 'class': 'right' }, [ ocui.closeButton(_('Close')), install ])
		]);
		// 探测挂载点填充下拉, 默认选可用空间最大的(满足≥2GB)
		api.installTargets().then(function(result) {
			var targets = ((result.data || {}).targets || []).slice().sort(function(a, b) { return (b.avail_mb || 0) - (a.avail_mb || 0); });
			var opts = targets.map(function(t) {
				return E('option', { value: t.path }, t.path + '  (' + _('Available') + ' ' + (t.free_str || '?') + ' / ' + (t.total_str || '?') + ', ' + t.fstype + ')' + (t.enough ? '' : ' ⚠'));
			});
			opts.push(E('option', { value: '__manual__' }, _('Enter another path manually...')));
			dom.content(mountSel, opts);
			// 默认: 优先 /opt(若空间足够, 符合惯例), 否则选可用空间最大且足够的, 再否则最大
			var enoughList = targets.filter(function(t) { return t.enough; });
			var def = enoughList.filter(function(t) { return t.path === '/opt'; })[0] || enoughList[0] || targets[0];
			mountSel.value = def ? def.path : '__manual__';
			path.style.display = (mountSel.value === '__manual__') ? '' : 'none';
			checkCapacity();
		}).catch(function() {
			// 探测失败兜底: 仅手动输入
			dom.content(mountSel, [ E('option', { value: '__manual__' }, _('Enter path manually')) ]);
			mountSel.value = '__manual__';
			path.style.display = '';
			checkCapacity();
		});
	},

	uninstall: function() {
		var self = this;
		var cbOpenclaw = E('input', { type: 'checkbox', checked: true });
		var cbNode = E('input', { type: 'checkbox' });
		// 只勾 Node.js(不卸 OpenClaw)不是卸载场景: 换 Node 版本应走「环境升级 → 更换 Node 版本」(就地整替换), 故此时禁用确认并给出引导。
		var hint = E('p', { style: 'display:none;color:var(--secondary-text-color,#888);font-size:.85em;margin:.2rem 0 0' },
			_('Switching the Node version needs no uninstall - use Runtime upgrade > Switch Node version to specify the version directly.'));
		var confirmBtn = E('button', { 'class': 'cbi-button-negative btn', click: function() {
			if (!cbOpenclaw.checked) return;
			var removeNode = cbNode.checked;
			ui.hideModal();
			return ocui.runOp(self.actionStatus, {
				running: _('"Uninstall runtime" command submitted'),
				success: _('Runtime uninstalled.'),
				submit: function() { return api.uninstall(removeNode); },
				cancel: function() { return api.taskCancel('openclaw-uninstall'); },
				onClose: L.bind(function() { if (this.taskPanel) this.taskPanel.style.display = 'none'; }, self),
				pollLog: function() { return api.uninstallLog(); },
				onLog: L.bind(function(d) { self.updateTaskPanel(_('Uninstall runtime'), { ok: true, data: d }); }, self),
				onDone: L.bind(function() { self.updateStatus(); }, self)
			});
		} }, _('Confirm uninstall'));
		var update = function() {
			hint.style.display = (!cbOpenclaw.checked && cbNode.checked) ? '' : 'none';
			confirmBtn.disabled = !cbOpenclaw.checked;
		};
		cbOpenclaw.addEventListener('change', update);
		cbNode.addEventListener('change', update);
		ui.showModal(_('Uninstall runtime'), [
			E('p', {}, _('Select the components to uninstall:')),
			E('div', { style: 'display:flex;flex-direction:column;gap:10px;margin:10px 0 4px' }, [
				E('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, [
					cbOpenclaw,
					E('span', {}, _('OpenClaw runtime and data'))
				]),
				E('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, [
					cbNode,
					E('span', {}, _('Node.js runtime'))
				])
			]),
			E('p', { style: 'color:var(--secondary-text-color,#888);font-size:.85em' },
				_('Node.js may be used by other software; leave unchecked to keep it.')),
			hint,
			E('div', { 'class': 'right', style: 'margin-top:12px' }, [
				E('button', { 'class': 'btn', click: function() { ui.hideModal(); } }, _('Cancel')),
				' ',
				confirmBtn
			])
		]);
		update();
	},

	checkUpgrade: function() {
		var self = this;
		return api.updateCheck().then(L.bind(function(result) {
			if (!result.ok) {
				ocui.setStatus(self.actionStatus, 'error', _(result.message || 'Detection failed'));
				return;
			}
			if (!result.data.plugin_has_update) {
				ocui.setStatus(self.actionStatus, 'success', _('Already the latest version (%s)').format(result.data.plugin_current));
				ocui.hideStatusLater(self.actionStatus);
				return;
			}
			// 发现新版本: 不再弹窗, 在状态信息区内联展示并提供「立即升级」按钮
			var version = result.data.plugin_latest;
			window.clearTimeout(self.actionStatus._ocHideTimer);
			self.actionStatus.className = 'oc-action-status oc-task-running';
			self.actionStatus.style.display = '';
			dom.content(self.actionStatus, [
				E('span', {}, _('New version %s available (current %s).').format(version, result.data.plugin_current)),
				' ',
				ocui.button(_('Upgrade now'), 'cbi-button-action', function() { return self.runPluginUpgrade(version); })
			]);
		}, this));
	},

	runPluginUpgrade: function(version) {
		var self = this;
		return ocui.runOp(this.actionStatus, {
			running: _('Upgrading LuCI app...'),
			success: _('Plugin upgrade completed.'),
			submit: function() { return api.upgrade(version); },
			cancel: function() { return api.taskCancel('openclaw-plugin-upgrade'); },
			onClose: L.bind(function() { if (this.taskPanel) this.taskPanel.style.display = 'none'; }, this),
			pollLog: function() { return api.upgradeLog(); },
			onLog: L.bind(function(d) { self.updateTaskPanel(_('Upgrade LuCI app'), { ok: true, data: d }); }, self),
			onDone: function(ok) {
				if (!ok) return;
				// rpcd reload(SIGHUP) 加载新后端并保留登录会话, 不强制重登录; 等其 re-exec 完成后自动刷新页面取回新前端。
				ocui.setStatus(self.actionStatus, 'running', _('Upgrade complete, reloading backend service...'));
				api.rpcdRestart();
				var tries = 0;
				var waitBack = function() {
					api.status().then(function(r) {
						if (r && r.ok) {
							ocui.setStatus(self.actionStatus, 'success', _('Upgrade complete, reloading page...'));
							window.location.reload();
						} else if (++tries < 15) {
							window.setTimeout(waitBack, 1000);
						} else {
							ocui.setStatus(self.actionStatus, 'success', _('Upgrade complete, please refresh the page manually.'));
						}
					}).catch(function() {
						if (++tries < 15) window.setTimeout(waitBack, 1000);
						else ocui.setStatus(self.actionStatus, 'success', _('Upgrade complete, please refresh the page manually.'));
					});
				};
				// 覆盖 rpcd_restart 的 1s sleep + re-exec 时间, 避免轮询命中尚未 reload 的旧 rpcd 而过早刷新。
				window.setTimeout(waitBack, 2500);
			}
		});
	},

	// 切换开机自启: 改 uci openclaw.main.enabled (init.d 总开关) + 同步 rc.d 软链; 不启停当前进程。
	toggleAutostart: function() {
		var on = (this._enabled !== '1');
		return ocui.runOp(this.actionStatus, {
			running: _('"%s" command submitted').format(on ? _('Enable autostart') : _('Disable autostart')),
			success: on ? _('Autostart enabled.') : _('Autostart disabled (the current process is unaffected).'),
			submit: function() { return api.autostartSet(on ? '1' : '0'); },
			onDone: L.bind(function() { this.updateStatus(); }, this)
		});
	},

	serviceAction: function(action) {
		return api.serviceAction(action).then(L.bind(function(result) {
			if (!result.ok) {
				ocui.setStatus(this.actionStatus, 'error', _(result.message || 'Operation failed'));
				return;
			}
			// 信息栏已由按钮包装显示「XX命令已提交」, 此处直接进入等待/刷新
			// enable/disable 立即生效，刷新一次即可
			if (action === 'enable' || action === 'disable') {
				return new Promise(function(resolve) { window.setTimeout(resolve, 600); })
					.then(L.bind(this.updateStatus, this))
					.then(L.bind(function() {
						this.actionStatus.className = 'oc-action-status oc-task-success';
						this.actionStatus.textContent = _('Operation succeeded');
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
						self.actionStatus.textContent = _('Gateway is ready and running.');
						self.hideActionStatusLater();
						return;
					}
					if (failed) {
						done();
						self.actionStatus.className = 'oc-action-status oc-task-error';
						self.actionStatus.textContent = _('Gateway failed to start; check the logs to troubleshoot.');
						return;
					}
				}
				else {
					if (!running && !starting) {
						done();
						self.actionStatus.className = 'oc-action-status oc-task-success';
						self.actionStatus.textContent = _('Gateway stopped.');
						self.hideActionStatusLater();
						return;
					}
				}
				if (Date.now() - start > timeoutMs) {
					done();
					self.actionStatus.className = 'oc-action-status oc-task-error';
					self.actionStatus.textContent = _('Operation timed out; the gateway was not ready in time. Refresh later to check.');
					return;
				}
				// 进行中: 徽章跟随后台真实相位（重启=停止中→启动中，停止=停止中）
				var badgeVariant, badgeText, statusText;
				if (!expectRunning || !starting) {
					badgeVariant = 'oc-state-stopping'; badgeText = _('Stopping');
					statusText = expectRunning ? _('Restarting gateway, waiting for it to stop...') : _('Stopping gateway...');
				} else {
					badgeVariant = 'oc-state-starting'; badgeText = _('Starting');
					statusText = _('Gateway is starting, please wait...');
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
		// 更换 Node 版本: 版本选择器(与安装对话框一致) + 自定义输入。底层 env-upgrade-node 会整删 NODE_BASE 再装所选版本(含降级)。
		var nodeSel = E('select', { 'class': 'cbi-input-select', 'style': 'width:auto' }, [
			E('option', { value: '22.22.3' }, 'Node 22.22.3'),
			E('option', { value: '24.17.0' }, 'Node 24.17.0'),
			E('option', { value: '__custom__' }, _('Custom version...'))
		]);
		var nodeCustom = E('input', { 'class': 'cbi-input-text', placeholder: 'x.y.z', 'style': 'display:none;width:7rem;margin-left:6px' });
		nodeSel.addEventListener('change', function() { nodeCustom.style.display = nodeSel.value === '__custom__' ? '' : 'none'; });
		var getNodeVer = function() { return nodeSel.value === '__custom__' ? nodeCustom.value.trim() : nodeSel.value; };
		// 默认选中当前已安装版本: 命中预置项则选中, 否则插入「(当前)」选项置顶并选中; 未安装则保持预置默认。
		api.status().then(function(res) {
			var nv = (((res && res.data) || {}).node_version || '').replace(/^v/, '');
			if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(nv)) return;
			for (var i = 0; i < nodeSel.options.length; i++)
				if (nodeSel.options[i].value === nv) { nodeSel.value = nv; return; }
			nodeSel.insertBefore(E('option', { value: nv }, 'Node ' + nv + _('(current)')), nodeSel.firstChild);
			nodeSel.value = nv;
		}).catch(function() {});
		var run = function(label, submitFn) {
			return ocui.runOp(status, {
				running: _('"%s" command submitted').format(label),
				success: _('%s done.').format(label),
				submit: submitFn,
				pollLog: function() { return api.envUpgradeLog(); },
				onLog: function(d) { log.style.display = ''; var text = (d.log || _('Waiting for output...')).split('\n').filter(function(l) { return !/packages? (are|is) looking for funding/.test(l) && !/[Rr]un `npm fund`/.test(l); }).join('\n'); ocui.setLog(log, text); }
			});
		};
		ui.showModal(_('Runtime upgrade'), [
			E('p', { 'class': 'oc-muted' }, _('Upgrade runtime components; the gateway restarts automatically to apply changes. "Switch Node version" fully replaces Node with the selected version (including downgrade), no need to uninstall Node first.')),
			E('div', { 'class': 'oc-actions' }, [
				ocui.button(_('Upgrade OpenClaw to latest'), 'cbi-button-positive', function() {
					ocui.setStatus(status, 'running', _('Checking version...'));
					return api.envUpgradeCheck().then(function(r) {
						if (!r.ok) { ocui.setStatus(status, 'error', _(r.message || 'Version check failed')); return; }
						var d = r.data || {};
						if (!d.has_update) { ocui.setStatus(status, 'success', _('Already up to date (core and plugins, %s)').format(d.current)); ocui.hideStatusLater(status); return; }
						// 发现可用更新(核心或插件): 内联展示并提供「立即升级」按钮, 不弹窗
						var msg = d.core_update
							? _('New OpenClaw version %s available (current %s).').format(d.latest, d.current)
							: _('OpenClaw core is up to date (%s); plugin/dependency updates are available.').format(d.current);
						window.clearTimeout(status._ocHideTimer);
						status.className = 'oc-action-status oc-task-running';
						status.style.display = '';
						dom.content(status, [
							E('span', {}, msg), ' ',
							ocui.button(_('Upgrade now'), 'cbi-button-action', function() { return run(_('Upgrade OpenClaw'), function() { return api.envUpgradeOpenclaw(); }); })
						]);
					}).catch(function(e) { ocui.setStatus(status, 'error', _(String(e && e.message || e || 'Version check failed'))); });
				}),
				ocui.button(_('Upgrade npm to latest'), 'cbi-button-action', function() {
					ocui.setStatus(status, 'running', _('Checking version...'));
					return api.envNpmCheck().then(function(r) {
						if (!r.ok) { ocui.setStatus(status, 'error', _(r.message || 'Version check failed')); return; }
						var d = r.data || {};
						if (!d.has_update) { ocui.setStatus(status, 'success', _('Already the latest version (%s)').format(d.current)); ocui.hideStatusLater(status); return; }
						// 发现新版本: 内联展示并提供「立即升级」按钮, 不弹窗
						window.clearTimeout(status._ocHideTimer);
						status.className = 'oc-action-status oc-task-running';
						status.style.display = '';
						dom.content(status, [
							E('span', {}, _('New version %s available (current %s).').format(d.latest, d.current)), ' ',
							ocui.button(_('Upgrade now'), 'cbi-button-action', function() { return run(_('Upgrade npm'), function() { return api.envUpgradeNpm(); }); })
						]);
					}).catch(function(e) { ocui.setStatus(status, 'error', _(String(e && e.message || e || 'Version check failed'))); });
				})
			]),
			E('div', { 'class': 'oc-field', 'style': 'margin-top:.5rem;align-items:center' }, [
				E('span', {}, _('Node version')),
				E('span', { 'class': 'oc-value' }, [ nodeSel, nodeCustom, ' ', ocui.button(_('Switch Node version'), 'cbi-button-action', function() {
					var v = getNodeVer();
					if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(v)) { ocui.setStatus(status, 'error', _('Invalid Node version format, enter x.y.z (e.g. 24.17.0).')); return; }
					return run(_('Switch Node version'), function() { return api.envUpgradeNode(v); });
				}) ])
			]),
			status, log,
			E('div', { 'class': 'right' }, [ ocui.closeButton(_('Close')) ])
		]);
	},

	showBackups: function() {
		var body = E('div', {}, _('Loading...'));
		var bkStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		var refresh = L.bind(function() {
			return api.backupList().then(L.bind(function(result) {
				var info = result.data || {};
				var pathInput = E('input', { type: 'text', 'class': 'cbi-input-text', style: 'width:20em;max-width:60%', value: info.backup_custom ? (info.backup_dir || '') : '', placeholder: info.backup_default || '' });
				var pathRow = E('div', { 'class': 'oc-backup-path' }, [
					E('div', { 'class': 'oc-hint' }, _('Backup directory (outside the install directory; not removed when uninstalling the runtime):') + ' ' + (info.backup_dir || '-')),
					E('div', { 'class': 'oc-actions', style: 'margin-top:6px' }, [
						pathInput,
						ocui.button(_('Save path'), 'cbi-button-action', function() { var v = (pathInput.value || '').replace(/^\s+|\s+$/g, ''); return ocui.runOp(bkStatus, { running: _('Updating backup path...'), success: _('Backup path updated.'), submit: function() { return api.backupPathSet(v); }, onDone: refresh }); }),
						info.backup_custom ? ocui.button(_('Restore defaults'), '', function() { return ocui.runOp(bkStatus, { running: _('Restoring default path...'), success: _('Default backup path restored.'), submit: function() { return api.backupPathSet(''); }, onDone: refresh }); }) : E('span')
					])
				]);
				var rows = (result.data.backups || []).map(L.bind(function(item) {
					return E('tr', {}, [ E('td', {}, item.backup_type === 'config' ? _('Config only') : _('Full')), E('td', {}, item.time || item.filename), E('td', {}, item.size_str), E('td', { 'class': 'oc-table-actions' }, [
						ocui.button(_('Verify'), '', function() { return ocui.runOp(bkStatus, { running: _('Verifying backup...'), success: _('Backup verified.'), submit: function() { return api.backupVerify(item.filename); } }); }),
						ocui.button(_('Restore'), 'cbi-button-action', function() { return ocui.confirm(_('Restoring overwrites the current state and restarts the service. Continue?'), { danger: true, confirmLabel: _('Restore') }).then(function(ok) { if (!ok) return; return ocui.runOp(bkStatus, { running: _('Restoring backup...'), success: _('Backup restored; service is restarting.'), submit: function() { return api.backupRestore(item.filename); }, onDone: refresh }); }); }),
						ocui.button(_('Delete'), 'cbi-button-negative', function() { return ocui.confirm(_('Delete this backup?'), { danger: true, confirmLabel: _('Delete') }).then(function(ok) { if (!ok) return; return ocui.runOp(bkStatus, { running: _('Deleting backup...'), success: _('Backup deleted.'), submit: function() { return api.backupDelete(item.filename); }, onDone: refresh }); }); })
					]) ]);
				}, this));
				dom.content(body, [ E('div', { 'class': 'oc-actions' }, [
					ocui.button(_('Create config backup'), 'cbi-button-positive', function() { return ocui.runOp(bkStatus, { running: _('Creating config backup...'), success: _('Config backup created.'), submit: function() { return api.backupCreate(true); }, onDone: refresh }); }),
					ocui.button(_('Create full backup'), 'cbi-button-action', function() { return ocui.runOp(bkStatus, { running: _('Creating full backup...'), success: _('Full backup created.'), submit: function() { return api.backupCreate(false); }, onDone: refresh }); })
				]), bkStatus, pathRow, E('table', { 'class': 'oc-table' }, [ E('tr', {}, [ E('th', {}, _('Type')), E('th', {}, _('Time / file')), E('th', {}, _('Size')), E('th', {}, _('Action')) ]) ].concat(rows)) ]);
			}, this));
		}, this);
		ui.showModal(_('Backup and restore'), [ body, E('div', { 'class': 'right' }, [ ocui.closeButton(_('Close')) ]) ]);
		refresh();
	},

	render: function(data) {
		var self = this;
		this._stableVersion = ((data[0] || {}).data || {}).stable_version || '';
		ocui.applyTheme();
		var ghLink = E('a', { href: 'https://github.com/tonylee2022/luci-app-openclaw', target: '_blank', rel: 'noopener', 'class': 'oc-gh' });
		ghLink.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg><span>github.com/tonylee2022/luci-app-openclaw</span>';
		var statusGroups = [
			{ label: _('Service'), fields: [ ['state', _('Status'), 'cbi-button oc-state-run oc-state-badge'], ['autostart', _('Autostart')], ['gateway', _('Gateway')], ['model', _('Active model')], ['channels', _('Messaging channels')] ] },
			{ label: '', fields: [ ['pid', _('PID')], ['memory', _('Memory')] ] },
			{ label: '', fields: [ ['node', _('Node.js')], ['openclaw', _('OpenClaw version')], ['plugin', _('Plugin version')], ['path', _('Install path')], ['node_path', _('Node.js path')], ['disk', _('Free space')] ] }
		];
		// 开机自启切换按钮: 移到快捷操作栏; 标签随状态在 updateStatus 更新
		this.autostartBtn = ocui.button(_('Toggle autostart'), 'cbi-button-action', L.bind(this.toggleAutostart, this));
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
			return ocui.button(label, css, function(ev) {
				ocui.setStatus(self.actionStatus, 'running', _('"%s" command submitted').format(label));
				return handler(ev);
			});
		};
		var actions = E('div', { 'class': 'oc-actions' }, [
			ocui.button(_('Install runtime'), 'cbi-button-positive', L.bind(this.showSetup, this)),
			act(_('Start'), 'cbi-button-action', L.bind(this.serviceAction, this, 'start')),
			act(_('Restart'), 'cbi-button-action', L.bind(this.serviceAction, this, 'restart')),
			act(_('Restart gateway only'), 'cbi-button-action', L.bind(this.serviceAction, this, 'restart_gateway')),
			act(_('Stop'), 'oc-btn-amber', L.bind(this.serviceAction, this, 'stop')),
			this.autostartBtn,
			act(_('Check for upgrades'), 'cbi-button-action', L.bind(this.checkUpgrade, this)),
			ocui.button(_('Runtime upgrade'), 'cbi-button-action', L.bind(this.showEnvUpgrade, this)),
			ocui.button(_('Backup / Restore'), 'cbi-button-action', L.bind(this.showBackups, this)),
			act(_('Uninstall runtime'), 'cbi-button-negative', L.bind(this.uninstall, this))
		]);
		this.actionStatus = E('div', { 'class': 'oc-action-status', 'style': 'display:none' });
		this.taskTitle = E('span', {}, _('System tasks'));
		this.taskClose = E('button', { 'type': 'button', 'class': 'cbi-button', 'style': 'display:none' }, _('Close'));
		this.taskClose.addEventListener('click', L.bind(function() { this.taskPanel.style.display = 'none'; }, this));
		this.taskState = E('div', { 'class': 'oc-task-state' }, _('No running tasks.'));
		this.taskLog = E('pre', { 'class': 'oc-log' }, '');
		this.taskPanel = E('div', { 'class': 'oc-card', 'style': 'display:none' }, [ E('div', { 'class': 'oc-card-title oc-task-title' }, [ this.taskTitle, this.taskClose ]), E('div', { 'class': 'oc-card-body' }, [ E('div', { 'class': 'oc-task-wrap' }, [ this.taskState, this.taskLog ]) ]) ]);
		var page = E('div', {}, [ E('link', { rel: 'stylesheet', href: L.resource('openclaw/openclaw.css') }), E('div', { 'class': 'oc-header' }, [ E('h2', {}, _('OpenClaw AI Gateway')), E('p', { 'class': 'oc-muted' }, _('Manage the OpenClaw runtime, procd service, upgrades, and backups.')) ]), E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-title' }, _('Status overview')), E('div', { 'class': 'oc-card-body' }, [ E('div', { 'class': 'oc-status-list' }, statusItems) ]) ]), E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-title' }, _('Quick actions')), E('div', { 'class': 'oc-card-body' }, [ actions, this.actionStatus ]) ]), this.taskPanel,
			E('div', { 'class': 'oc-card' }, [ E('div', { 'class': 'oc-card-title' }, _('Quick guide')), E('div', { 'class': 'oc-card-body' }, [ E('ol', { 'class': 'oc-guide' }, [
				E('li', {}, _('First time: click Install runtime, then configure models/channels under Configuration > Official setup or via openclaw-shell.')),
				E('li', {}, _('After config changes, click Restart or Restart gateway to apply; a Running status badge means it is healthy.')),
				E('li', {}, _('Configure WeChat / Telegram under Configuration > Channels; troubleshoot via Configuration > Health check or openclaw doctor.'))
			]), E('p', { 'class': 'oc-muted', 'style': 'margin:.7rem 0 0; text-align:right' }, [ _('Project home / feedback:'), ghLink ]) ]) ]) ]);
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
