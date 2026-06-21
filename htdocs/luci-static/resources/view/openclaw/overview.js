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
				state: d.gateway_running ? _('运行中') : d.gateway_starting ? _('启动中') : d.gateway_failed ? _('启动失败') : _('已停止'),
				autostart: d.enabled === '1' ? _('是') : _('否'),
				gateway: d.gateway_running ? _('监听端口 %s').format(d.port) : _('未监听'),
				model: d.active_model || _('未配置'), channels: d.channels || _('未配置'), pid: d.pid || '-',
				memory: d.memory_kb ? (d.memory_kb / 1024).toFixed(1) + ' MB' : '-', node: d.node_version || _('未安装'),
				openclaw: d.oc_version || _('未安装'), plugin: d.plugin_version || '-', path: d.oc_version ? (d.install_path || '-') : '-', node_path: d.node_version ? (d.node_path || '-') : '-', disk: d.disk_free || '-'
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
				this.taskState.textContent = _('安装完成！服务已自动启用，请刷新页面查看状态。');
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
		// Node.js 版本: 稳定版(默认) / 最新版 / 自定义输入
		var nodeVerSel = E('select', { 'class': 'cbi-input-select oc-input', style: 'width:auto' }, [
			E('option', { value: '22.22.3' }, 'Node 22.22.3'),
			E('option', { value: '24.17.0' }, 'Node 24.17.0'),
			E('option', { value: '__custom__' }, _('自定义版本…'))
		]);
		var nodeVerCustom = E('input', {
			'class': 'cbi-input-text oc-input',
			placeholder: 'x.y.z',
			style: 'display:none;width:96px;margin-left:6px'
		});
		var nodeVerHint = E('span', {
			style: 'display:none;color:var(--secondary-text-color,#888);font-size:.85em;margin-left:4px'
		}, _('格式：x.y.z'));
		nodeVerSel.addEventListener('change', function() {
			var custom = nodeVerSel.value === '__custom__';
			nodeVerCustom.style.display = custom ? '' : 'none';
			nodeVerHint.style.display = custom ? '' : 'none';
		});
		var getNodeVer = function() {
			return nodeVerSel.value === '__custom__' ? nodeVerCustom.value.trim() : nodeVerSel.value;
		};
		// 挂载点下拉(由 install_targets 填充) + 手动输入(默认隐藏)
		var mountSel = E('select', { 'class': 'cbi-input-select oc-input' }, [ E('option', { value: '' }, _('正在探测挂载点...')) ]);
		var path = E('input', { 'class': 'cbi-input-text oc-input', value: '/opt', 'style': 'display:none' });
		var capacity = E('div', { 'class': 'oc-capacity' }, _('正在检查安装路径容量...'));
		var progress = E('div', { 'class': 'oc-task-state', 'style': 'display:none' }, '');
		var checkedPath = null;
		var checkTimer = null;
		// 当前选定的基路径: 下拉非「手动」时取下拉值, 否则取手动输入框
		var currentBase = function() { return mountSel.value === '__manual__' ? path.value : mountSel.value; };
		var install = ocui.button(_('开始安装'), 'cbi-button-positive', L.bind(function() {
			if (!checkedPath || checkedPath !== currentBase()) {
				progress.style.display = '';
				progress.className = 'oc-task-state oc-task-error';
				progress.textContent = _('安装路径已变化，请等待容量检查完成。');
				return;
			}
			var nv = getNodeVer();
			if (nodeVerSel.value === '__custom__' && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(nv)) {
				progress.style.display = '';
				progress.className = 'oc-task-state oc-task-error';
				progress.textContent = _('Node.js 版本格式无效，请输入 x.y.z 格式（如 24.17.0）。');
				return;
			}
			install.disabled = true;
			version.disabled = true;
			path.disabled = true;
			progress.style.display = '';
			progress.className = 'oc-task-state oc-task-running';
			progress.textContent = _('正在启动后台安装任务...');
			var submittedAt = Math.floor(Date.now() / 1000);
			return api.setup(version.value, checkedPath, nv).then(L.bind(function(result) {
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
			E('div', { 'class': 'oc-form-row' }, [
				E('label', {}, _('Node.js 版本')),
				E('div', { style: 'display:flex;align-items:center;flex-wrap:wrap;gap:4px' }, [ nodeVerSel, nodeVerCustom, nodeVerHint ])
			]),
			E('div', { 'class': 'oc-form-row' }, [ E('label', {}, _('安装位置')), mountSel ]),
			E('div', { 'class': 'oc-form-row' }, [ E('label', {}, _('自定义路径')), path ]),
			capacity,
			progress,
			E('div', { 'class': 'right' }, [ ocui.closeButton(_('关闭')), install ])
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
		var self = this;
		var cbOpenclaw = E('input', { type: 'checkbox', checked: true });
		var cbNode = E('input', { type: 'checkbox' });
		// 只勾 Node.js(不卸 OpenClaw)不是卸载场景: 换 Node 版本应走「环境升级 → 更换 Node 版本」(就地整替换), 故此时禁用确认并给出引导。
		var hint = E('p', { style: 'display:none;color:var(--secondary-text-color,#888);font-size:.85em;margin:.2rem 0 0' },
			_('更换 Node 版本无需卸载——请用「环境升级 → 更换 Node 版本」直接指定版本。'));
		var confirmBtn = E('button', { 'class': 'cbi-button-negative btn', click: function() {
			if (!cbOpenclaw.checked) return;
			var removeNode = cbNode.checked;
			ui.hideModal();
			return ocui.runOp(self.actionStatus, {
				running: _('「卸载环境」命令已提交'),
				success: _('运行环境已卸载。'),
				submit: function() { return api.uninstall(removeNode); },
				cancel: function() { return api.taskCancel('openclaw-uninstall'); },
				onClose: L.bind(function() { if (this.taskPanel) this.taskPanel.style.display = 'none'; }, self),
				pollLog: function() { return api.uninstallLog(); },
				onLog: L.bind(function(d) { self.updateTaskPanel(_('卸载运行环境'), { ok: true, data: d }); }, self),
				onDone: L.bind(function() { self.updateStatus(); }, self)
			});
		} }, _('确认卸载'));
		var update = function() {
			hint.style.display = (!cbOpenclaw.checked && cbNode.checked) ? '' : 'none';
			confirmBtn.disabled = !cbOpenclaw.checked;
		};
		cbOpenclaw.addEventListener('change', update);
		cbNode.addEventListener('change', update);
		ui.showModal(_('卸载运行环境'), [
			E('p', {}, _('请选择要卸载的组件：')),
			E('div', { style: 'display:flex;flex-direction:column;gap:10px;margin:10px 0 4px' }, [
				E('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, [
					cbOpenclaw,
					E('span', {}, _('OpenClaw 运行环境及数据'))
				]),
				E('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, [
					cbNode,
					E('span', {}, _('Node.js 运行时'))
				])
			]),
			E('p', { style: 'color:var(--secondary-text-color,#888);font-size:.85em' },
				_('Node.js 可供其他用途使用，不勾选则保留。')),
			hint,
			E('div', { 'class': 'right', style: 'margin-top:12px' }, [
				E('button', { 'class': 'btn', click: function() { ui.hideModal(); } }, _('取消')),
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
				ocui.setStatus(self.actionStatus, 'error', result.message || _('检测失败'));
				return;
			}
			if (!result.data.plugin_has_update) {
				ocui.setStatus(self.actionStatus, 'success', _('当前已是最新版本（%s）').format(result.data.plugin_current));
				ocui.hideStatusLater(self.actionStatus);
				return;
			}
			// 发现新版本: 不再弹窗, 在状态信息区内联展示并提供「立即升级」按钮
			var version = result.data.plugin_latest;
			window.clearTimeout(self.actionStatus._ocHideTimer);
			self.actionStatus.className = 'oc-action-status oc-task-running';
			self.actionStatus.style.display = '';
			dom.content(self.actionStatus, [
				E('span', {}, _('发现新版本 %s（当前 %s）。').format(version, result.data.plugin_current)),
				' ',
				ocui.button(_('立即升级'), 'cbi-button-action', function() { return self.runPluginUpgrade(version); })
			]);
		}, this));
	},

	runPluginUpgrade: function(version) {
		var self = this;
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
				// rpcd reload(SIGHUP) 加载新后端并保留登录会话, 不强制重登录; 等其 re-exec 完成后自动刷新页面取回新前端。
				ocui.setStatus(self.actionStatus, 'running', _('升级完成，正在重载后端服务…'));
				api.rpcdRestart();
				var tries = 0;
				var waitBack = function() {
					api.status().then(function(r) {
						if (r && r.ok) {
							ocui.setStatus(self.actionStatus, 'success', _('升级完成，正在刷新页面…'));
							window.location.reload();
						} else if (++tries < 15) {
							window.setTimeout(waitBack, 1000);
						} else {
							ocui.setStatus(self.actionStatus, 'success', _('升级完成，请手动刷新页面。'));
						}
					}).catch(function() {
						if (++tries < 15) window.setTimeout(waitBack, 1000);
						else ocui.setStatus(self.actionStatus, 'success', _('升级完成，请手动刷新页面。'));
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
		// 更换 Node 版本: 版本选择器(与安装对话框一致) + 自定义输入。底层 env-upgrade-node 会整删 NODE_BASE 再装所选版本(含降级)。
		var nodeSel = E('select', { 'class': 'cbi-input-select', 'style': 'width:auto' }, [
			E('option', { value: '22.22.3' }, 'Node 22.22.3'),
			E('option', { value: '24.17.0' }, 'Node 24.17.0'),
			E('option', { value: '__custom__' }, _('自定义版本…'))
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
			nodeSel.insertBefore(E('option', { value: nv }, 'Node ' + nv + _('（当前）')), nodeSel.firstChild);
			nodeSel.value = nv;
		}).catch(function() {});
		var run = function(label, submitFn) {
			return ocui.runOp(status, {
				running: _('「%s」命令已提交').format(label),
				success: _('%s完成。').format(label),
				submit: submitFn,
				pollLog: function() { return api.envUpgradeLog(); },
				onLog: function(d) { log.style.display = ''; var text = (d.log || _('等待输出...')).split('\n').filter(function(l) { return !/packages? (are|is) looking for funding/.test(l) && !/[Rr]un `npm fund`/.test(l); }).join('\n'); ocui.setLog(log, text); }
			});
		};
		ui.showModal(_('环境升级'), [
			E('p', { 'class': 'oc-muted' }, _('升级运行环境组件，变更后自动重启网关生效。「更换 Node 版本」会整体替换为所选版本（含降级），无需先卸载 Node。')),
			E('div', { 'class': 'oc-actions' }, [
				ocui.button(_('升级 OpenClaw 最新版'), 'cbi-button-positive', function() {
					ocui.setStatus(status, 'running', _('正在检查版本...'));
					return api.envUpgradeCheck().then(function(r) {
						if (!r.ok) { ocui.setStatus(status, 'error', r.message || _('版本检查失败')); return; }
						var d = r.data || {};
						if (!d.has_update) { ocui.setStatus(status, 'success', _('当前已是最新（核心与插件，%s）').format(d.current)); ocui.hideStatusLater(status); return; }
						// 发现可用更新(核心或插件): 内联展示并提供「立即升级」按钮, 不弹窗
						var msg = d.core_update
							? _('发现 OpenClaw 新版本 %s（当前 %s）。').format(d.latest, d.current)
							: _('OpenClaw 核心已最新（%s），发现插件/依赖更新可用。').format(d.current);
						window.clearTimeout(status._ocHideTimer);
						status.className = 'oc-action-status oc-task-running';
						status.style.display = '';
						dom.content(status, [
							E('span', {}, msg), ' ',
							ocui.button(_('立即升级'), 'cbi-button-action', function() { return run(_('升级 OpenClaw'), function() { return api.envUpgradeOpenclaw(); }); })
						]);
					}).catch(function(e) { ocui.setStatus(status, 'error', String(e && e.message || e || _('版本检查失败'))); });
				}),
				ocui.button(_('升级 npm 最新版'), 'cbi-button-action', function() {
					ocui.setStatus(status, 'running', _('正在检查版本...'));
					return api.envNpmCheck().then(function(r) {
						if (!r.ok) { ocui.setStatus(status, 'error', r.message || _('版本检查失败')); return; }
						var d = r.data || {};
						if (!d.has_update) { ocui.setStatus(status, 'success', _('当前已是最新版本（%s）').format(d.current)); ocui.hideStatusLater(status); return; }
						// 发现新版本: 内联展示并提供「立即升级」按钮, 不弹窗
						window.clearTimeout(status._ocHideTimer);
						status.className = 'oc-action-status oc-task-running';
						status.style.display = '';
						dom.content(status, [
							E('span', {}, _('发现新版本 %s（当前 %s）。').format(d.latest, d.current)), ' ',
							ocui.button(_('立即升级'), 'cbi-button-action', function() { return run(_('升级 npm'), function() { return api.envUpgradeNpm(); }); })
						]);
					}).catch(function(e) { ocui.setStatus(status, 'error', String(e && e.message || e || _('版本检查失败'))); });
				})
			]),
			E('div', { 'class': 'oc-field', 'style': 'margin-top:.5rem;align-items:center' }, [
				E('span', {}, _('Node 版本')),
				E('span', { 'class': 'oc-value' }, [ nodeSel, nodeCustom, ' ', ocui.button(_('更换 Node 版本'), 'cbi-button-action', function() {
					var v = getNodeVer();
					if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(v)) { ocui.setStatus(status, 'error', _('Node 版本格式无效，请输入 x.y.z（如 24.17.0）。')); return; }
					return run(_('更换 Node 版本'), function() { return api.envUpgradeNode(v); });
				}) ])
			]),
			status, log,
			E('div', { 'class': 'right' }, [ ocui.closeButton(_('关闭')) ])
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
						ocui.button(_('保存路径'), 'cbi-button-action', function() { var v = (pathInput.value || '').replace(/^\s+|\s+$/g, ''); return ocui.runOp(bkStatus, { running: _('正在更新备份路径...'), success: _('备份路径已更新。'), submit: function() { return api.backupPathSet(v); }, onDone: refresh }); }),
						info.backup_custom ? ocui.button(_('恢复默认'), '', function() { return ocui.runOp(bkStatus, { running: _('正在恢复默认路径...'), success: _('已恢复默认备份路径。'), submit: function() { return api.backupPathSet(''); }, onDone: refresh }); }) : E('span')
					])
				]);
				var rows = (result.data.backups || []).map(L.bind(function(item) {
					return E('tr', {}, [ E('td', {}, item.backup_type === 'config' ? _('仅配置') : _('完整')), E('td', {}, item.time || item.filename), E('td', {}, item.size_str), E('td', { 'class': 'oc-table-actions' }, [
						ocui.button(_('验证'), '', function() { return ocui.runOp(bkStatus, { running: _('正在验证备份...'), success: _('备份验证通过。'), submit: function() { return api.backupVerify(item.filename); } }); }),
						ocui.button(_('恢复'), 'cbi-button-action', function() { return ocui.confirm(_('恢复会覆盖当前状态并重启服务，确定继续？'), { danger: true, confirmLabel: _('恢复') }).then(function(ok) { if (!ok) return; return ocui.runOp(bkStatus, { running: _('正在恢复备份...'), success: _('备份已恢复，服务重启中。'), submit: function() { return api.backupRestore(item.filename); }, onDone: refresh }); }); }),
						ocui.button(_('删除'), 'cbi-button-negative', function() { return ocui.confirm(_('确定删除此备份？'), { danger: true, confirmLabel: _('删除') }).then(function(ok) { if (!ok) return; return ocui.runOp(bkStatus, { running: _('正在删除备份...'), success: _('备份已删除。'), submit: function() { return api.backupDelete(item.filename); }, onDone: refresh }); }); })
					]) ]);
				}, this));
				dom.content(body, [ E('div', { 'class': 'oc-actions' }, [
					ocui.button(_('创建配置备份'), 'cbi-button-positive', function() { return ocui.runOp(bkStatus, { running: _('正在创建配置备份...'), success: _('配置备份已创建。'), submit: function() { return api.backupCreate(true); }, onDone: refresh }); }),
					ocui.button(_('创建完整备份'), 'cbi-button-action', function() { return ocui.runOp(bkStatus, { running: _('正在创建完整备份...'), success: _('完整备份已创建。'), submit: function() { return api.backupCreate(false); }, onDone: refresh }); })
				]), bkStatus, pathRow, E('table', { 'class': 'oc-table' }, [ E('tr', {}, [ E('th', {}, _('类型')), E('th', {}, _('时间/文件')), E('th', {}, _('大小')), E('th', {}, _('操作')) ]) ].concat(rows)) ]);
			}, this));
		}, this);
		ui.showModal(_('备份与恢复'), [ body, E('div', { 'class': 'right' }, [ ocui.closeButton(_('关闭')) ]) ]);
		refresh();
	},

	render: function(data) {
		var self = this;
		this._stableVersion = ((data[0] || {}).data || {}).stable_version || '';
		ocui.applyTheme();
		var ghLink = E('a', { href: 'https://github.com/tonylee2022/luci-app-openclaw', target: '_blank', rel: 'noopener', 'class': 'oc-gh' });
		ghLink.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg><span>github.com/tonylee2022/luci-app-openclaw</span>';
		var statusGroups = [
			{ label: _('服务'), fields: [ ['state', _('状态'), 'cbi-button oc-state-run oc-state-badge'], ['autostart', _('开机自启')], ['gateway', _('网关')], ['model', _('活跃模型')], ['channels', _('消息渠道')] ] },
			{ label: '', fields: [ ['pid', _('PID')], ['memory', _('内存')] ] },
			{ label: '', fields: [ ['node', _('Node.js')], ['openclaw', _('OpenClaw 版本')], ['plugin', _('插件版本')], ['path', _('安装路径')], ['node_path', _('Node.js 路径')], ['disk', _('剩余空间')] ] }
		];
		// 开机自启切换按钮: 移到快捷操作栏; 标签随状态在 updateStatus 更新
		this.autostartBtn = ocui.button(_('切换开机自启'), 'cbi-button-action', L.bind(this.toggleAutostart, this));
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
				ocui.setStatus(self.actionStatus, 'running', _('「%s」命令已提交').format(label));
				return handler(ev);
			});
		};
		var actions = E('div', { 'class': 'oc-actions' }, [
			ocui.button(_('安装运行环境'), 'cbi-button-positive', L.bind(this.showSetup, this)),
			act(_('启动'), 'cbi-button-action', L.bind(this.serviceAction, this, 'start')),
			act(_('重启'), 'cbi-button-action', L.bind(this.serviceAction, this, 'restart')),
			act(_('仅重启网关'), 'cbi-button-action', L.bind(this.serviceAction, this, 'restart_gateway')),
			act(_('停止'), 'oc-btn-amber', L.bind(this.serviceAction, this, 'stop')),
			this.autostartBtn,
			act(_('检测升级'), 'cbi-button-action', L.bind(this.checkUpgrade, this)),
			ocui.button(_('环境升级'), 'cbi-button-action', L.bind(this.showEnvUpgrade, this)),
			ocui.button(_('备份/恢复'), 'cbi-button-action', L.bind(this.showBackups, this)),
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
