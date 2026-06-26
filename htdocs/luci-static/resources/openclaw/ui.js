'use strict';
'require baseclass';
'require ui';

// OpenClaw 统一操作交互 (以「仅重启网关」为模板): 内联状态条 + 操作运行器。
// button/closeButton 已统一收口至此; 状态条与操作运行器在按钮 handler 中调用。
return baseclass.extend({
	// 跟随当前 LuCI 主题(明/暗)给 <html> 加/去 oc-dark 类, 使插件自带的明暗样式跟着主题切换,
	// 而非只认 OS 的 prefers-color-scheme。检测: 采样 body 文字颜色亮度(暗色主题文字浅、亮色文字深),
	// 比采样背景可靠(背景可能是壁纸/透明)。主题切换通常会刷新页面, 故渲染时检测即可; 另延时复检一次。
	applyTheme: function() {
		function detect() {
			try {
				var c = window.getComputedStyle(document.body).color || '';
				var m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
				if (!m) return;
				var lum = 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
				document.documentElement.classList.toggle('oc-dark', lum > 140);
			} catch (e) {}
		}
		detect();
		window.setTimeout(detect, 300);
	},

	// 内联状态条 (oc-action-status oc-task-running/success/error)
	setStatus: function(el, kind, text) {
		if (!el) return;
		window.clearTimeout(el._ocHideTimer);
		el.className = 'oc-action-status oc-task-' + kind;
		el.textContent = text;
		el.style.display = '';
	},

	hideStatusLater: function(el, ms) {
		if (!el) return;
		window.clearTimeout(el._ocHideTimer);
		el._ocHideTimer = window.setTimeout(function() { el.style.display = 'none'; }, ms || 4000);
	},

	// 写日志文本并"粘底": 仅当用户本来就在底部附近时才跟随到底, 否则保持当前滚动位置
	// (避免任务完成/轮询刷新时把用户看历史的视图强制拉到最后)。
	setLog: function(el, text) {
		if (!el) return;
		var stick = (el.scrollHeight - el.scrollTop - el.clientHeight) < 24;
		el.textContent = text;
		if (stick) el.scrollTop = el.scrollHeight;
	},

	// 统一操作运行器: 提交→(可选轮询任务到 done)→成功/失败(自动收起)。
	// 返回 promise, 全程 pending → 配合 button() 使按钮保持忙到真正完成。
	// opts: { running, success, submit(), pollLog()?, onLog(d)?, onDone(ok,d)?, cancel()?, onClose()?, timeoutMs?, stepMs? }
	// opts.cancel: 提供则运行中显示「关闭」按钮。关闭=停止并杀掉后台进程(等价命令行 Ctrl+C)+收起面板。
	// opts.onClose: 关闭时由视图收起自己的日志/二维码等面板元素。
	runOp: function(el, opts) {
		var self = this;
		opts = opts || {};
		var closed = false;
		// 关闭: 杀后台进程 + 收起面板 + 停止轮询。
		function doClose() {
			if (closed) return;
			closed = true;
			if (opts.cancel) Promise.resolve().then(function() { return opts.cancel(); });
			if (opts.onClose) opts.onClose();
			if (el) el.style.display = 'none';
		}
		// 显示「运行中」并在可关闭时附加「关闭」按钮。
		function running(text) {
			if (closed) return;
			self.setStatus(el, 'running', text || opts.running || _('Processing...'));
			if (opts.cancel && el) {
				var b = document.createElement('button');
				b.className = 'cbi-button';
				b.style.marginLeft = '.6rem';
				b.style.padding = '0 .6rem';
				b.textContent = _('Close');
				b.addEventListener('click', doClose);
				el.appendChild(b);
			}
		}
		running();
		return Promise.resolve().then(function() { return opts.submit(); }).then(function(r) {
			if (closed) return;
			if (r && r.ok === false) {
				self.setStatus(el, 'error', _(r.message || 'Operation failed'));
				return;
			}
			if (!opts.pollLog) {
				self.setStatus(el, 'success', opts.success || _('Operation succeeded'));
				self.hideStatusLater(el);
				if (opts.onDone) opts.onDone(true, r);
				return;
			}
			var start = Date.now(), step = opts.stepMs || 2000, to = opts.timeoutMs || 600000;
			return new Promise(function(resolve) {
				(function tick() {
					if (closed) return resolve();
					Promise.resolve().then(function() { return opts.pollLog(); }).then(function(res) {
						if (closed) return resolve();
						var d = (res && res.data) || {};
						if (opts.onLog) opts.onLog(d);
						if (d.done) {
							if (d.exit_code === 130) {
								self.setStatus(el, 'error', _('Closed'));
								self.hideStatusLater(el);
								if (opts.onDone) opts.onDone(false, d);
								return resolve();
							}
							var ok = (d.exit_code === 0);
							self.setStatus(el, ok ? 'success' : 'error', ok ? (opts.success || _('Operation succeeded')) : _('Failed, exit code: %s').format(d.exit_code));
							if (ok) self.hideStatusLater(el);
							if (opts.onDone) opts.onDone(ok, d);
							return resolve();
						}
						if (Date.now() - start > to) {
							self.setStatus(el, 'error', _('Operation timed out; refresh later to check.'));
							return resolve();
						}
						running();
						window.setTimeout(tick, step);
					}).catch(function() { if (!closed) window.setTimeout(tick, step); });
				})();
			});
		}).catch(function(err) {
			if (!closed) self.setStatus(el, 'error', _(String((err && err.message) || err || 'Operation failed')));
		});
	},

	button: function(label, css, handler) {
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
	},

	// 主题化确认框: 替代原生 confirm()。用独立 overlay(不占用 LuCI 单例 modalDiv), 故可叠加在已打开的模态(如备份列表)之上。
	// 返回 Promise<boolean>。opts: { title, confirmLabel, cancelLabel, danger }
	confirm: function(message, opts) {
		opts = opts || {};
		return new Promise(function(resolve) {
			var settled = false, overlay;
			function done(v) {
				if (settled) return;
				settled = true;
				document.removeEventListener('keydown', onKey, true);
				if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
				resolve(v);
			}
			function onKey(ev) {
				if (ev.key === 'Escape') { ev.stopPropagation(); done(false); }
				else if (ev.key === 'Enter') { ev.stopPropagation(); done(true); }
			}
			var okBtn = E('button', { 'type': 'button', 'class': 'cbi-button ' + (opts.danger ? 'cbi-button-negative' : 'cbi-button-action') }, opts.confirmLabel || _('OK'));
			okBtn.addEventListener('click', function() { done(true); });
			var cancelBtn = E('button', { 'type': 'button', 'class': 'cbi-button' }, opts.cancelLabel || _('Cancel'));
			cancelBtn.addEventListener('click', function() { done(false); });
			overlay = E('div', { 'class': 'oc-confirm-overlay' }, [
				E('div', { 'class': 'oc-confirm-box' }, [
					opts.title ? E('h4', { 'class': 'oc-confirm-title' }, opts.title) : '',
					E('p', { 'class': 'oc-confirm-msg' }, message),
					E('div', { 'class': 'right oc-confirm-actions' }, [ cancelBtn, ' ', okBtn ])
				])
			]);
			overlay.addEventListener('click', function(ev) { if (ev.target === overlay) done(false); });
			document.body.appendChild(overlay);
			document.addEventListener('keydown', onKey, true);
			okBtn.focus();
		});
	},

	closeButton: function(label, beforeClose) {
		var btn = E('button', { 'type': 'button', 'class': 'cbi-button' }, label);
		btn.addEventListener('click', function(ev) {
			ev.preventDefault();
			ev.stopPropagation();
			if (beforeClose) beforeClose();
			ui.hideModal();
		});
		return btn;
	}
});
