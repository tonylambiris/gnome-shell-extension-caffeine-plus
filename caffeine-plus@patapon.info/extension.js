/* -*- mode: js2 - indent-tabs-mode: nil - js2-basic-offset: 4 -*- */
/*jshint multistr:true */
/*jshint esnext:true */
/*global imports: true */
/*global global: true */
/*global log: true */
/**
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

'use strict';

const Meta = imports.gi.Meta;
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PanelMenu = imports.ui.panelMenu;
const Shell = imports.gi.Shell;
const MessageTray = imports.ui.messageTray;
const Atk = imports.gi.Atk;
const Config = imports.misc.config;

// below are default inhibit flags
const INHIBIT_LOGOUT = 1; // logging out
const INHIBIT_SWITCH = 2; // switching user
const INHIBIT_SUSPEND = 4; // well, weird value, seems got it while playing audio stream only
const INHIBIT_IDLE = 8; // playing, for fullscreen: 4 + 8
const INHIBIT_AUTO_MOUNT = 16; // auto-mouting media

// mask for inhibit flags
//const MASK_SUSPEND_DISABLE_INHIBIT = INHIBIT_SUSPEND | INHIBIT_IDLE | INHIBIT_AUTO_MOUNT;
const MASK_SUSPEND_DISABLE_INHIBIT = INHIBIT_IDLE | INHIBIT_AUTO_MOUNT;
const MASK_SUSPEND_ENABLE_INHIBIT =  INHIBIT_LOGOUT | INHIBIT_SWITCH;

const INHIBIT_APPS_KEY = 'inhibit-apps';
const SHOW_INDICATOR_KEY = 'show-indicator';
const SHOW_NOTIFICATIONS_KEY = 'show-notifications';
const USER_ENABLED_KEY = 'user-enabled';
const RESTORE_KEY = 'restore-state';
const FULLSCREEN_KEY = 'enable-fullscreen';

const Gettext = imports.gettext.domain('gnome-shell-extension-caffeine-plus');
const _ = Gettext.gettext;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const DBusSessionManagerIface = '<node>\
  <interface name="org.gnome.SessionManager">\
    <method name="Inhibit">\
        <arg type="s" direction="in" />\
        <arg type="u" direction="in" />\
        <arg type="s" direction="in" />\
        <arg type="u" direction="in" />\
        <arg type="u" direction="out" />\
    </method>\
    <method name="Uninhibit">\
        <arg type="u" direction="in" />\
    </method>\
	<method name="GetInhibitors">\
	    <arg type="ao" direction="out" />\
	</method>\
    <signal name="InhibitorAdded">\
        <arg type="o" direction="out" />\
    </signal>\
    <signal name="InhibitorRemoved">\
	    <arg type="o" />\
	</signal>\
  </interface>\
</node>';
const DBusSessionManagerProxy = Gio.DBusProxy.makeProxyWrapper(DBusSessionManagerIface);

const DBusSessionManagerInhibitorIface = '<node>\
  <interface name="org.gnome.SessionManager.Inhibitor">\
    <method name="GetFlags">\
	    <arg type="u" direction="out" />\
	</method>\
  </interface>\
</node>';
const DBusSessionManagerInhibitorProxy = Gio.DBusProxy.makeProxyWrapper(DBusSessionManagerInhibitorIface);

const IndicatorName = "Caffeine";
const enableSuspendIcon = {'app': 'my-caffeine-off-symbolic', 'user': 'my-caffeine-off-symbolic-user'};
const disableSuspendIcon = {'app': 'my-caffeine-on-symbolic', 'user': 'my-caffeine-on-symbolic-user'};

var __next_objid=1;
let CaffeineIndicator;
let ShellVersion = parseInt(Config.PACKAGE_VERSION.split(".")[1]);

const Caffeine = new Lang.Class({
    Name: IndicatorName,
    Extends: PanelMenu.Button,

    _init: function(metadata, params) {
        this._apps = []; // for caffeine
        this._cookies = [];
        
        this._inhibitors = []; // for handling inhibitors from system
        this._windows = []; // for handling window instance
        
        this.parent(null, IndicatorName);
        this.actor.accessible_role = Atk.Role.TOGGLE_BUTTON;

        this._settings = Convenience.getSettings();
        this._settings.connect("changed::" + SHOW_INDICATOR_KEY, Lang.bind(this, function() {
            if (this._settings.get_boolean(SHOW_INDICATOR_KEY))
                this.actor.show();
            else
                this.actor.hide();
        }));
        if (!this._settings.get_boolean(SHOW_INDICATOR_KEY))
            this.actor.hide();

        this._sessionManager = new DBusSessionManagerProxy(Gio.DBus.session,
                                                          'org.gnome.SessionManager',
                                                          '/org/gnome/SessionManager');
        
        // handle all inhibitors from system, include created by other apps
        this._inhibitorAddedId = this._sessionManager.connectSignal('InhibitorAdded',
                                                                    Lang.bind(this, this._inhibitorAdded));
        
        // handle all inhibitors removed
        this._inhibitorRemovedId = this._sessionManager.connectSignal('InhibitorRemoved',
                													Lang.bind(this, this._inhibitorRemoved));
        
        // handle all apps 
        this._windowCreatedId = global.screen.get_display().connect_after('window-created', Lang.bind(this, function (display, window, noRecurse) {
        	if (this._settings.get_boolean(FULLSCREEN_KEY)) {
        		// screen signal "in-fullscreen-changed" not always catch the right window instance
        		// so need to listen signal "size-changed" on per app
            	let app_id = this.getWindowID(window);
        		this._windows[app_id] = window.connect('size-changed', Lang.bind(this, this.toggleFullscreenWindow));
        	}
        	this._mayUserInhibit(display, window, noRecurse);
        }));
        this._windowDestroyedId = global.window_manager.connect('destroy', Lang.bind(this, function (shellwm, actor) {
        	let app_id = this.getWindowID(actor.meta_window);
        	this.removeInhibit(app_id);
        	if (this._windows[app_id]) {
        		actor.meta_window.disconnect(this._windows[app_id]);
            	delete this._windows[app_id];
            }
        	this._mayUserUninhibit(shellwm, actor);
        }));

        let icon_name = enableSuspendIcon['app'];
        if (this._settings.get_boolean(USER_ENABLED_KEY))
        	icon_name = enableSuspendIcon['user'];
        	
        this._icon = new St.Icon({
            icon_name: icon_name,
            style_class: 'system-status-icon'
        });

        this.actor.add_actor(this._icon);
        this.actor.add_style_class_name('panel-status-button');
        this.actor.connect('button-press-event', Lang.bind(this, this.userToggleState));
        this.actor.connect_after('key-release-event', Lang.bind(this, function (actor, event) {
        	let symbol = event.get_key_symbol();
            if (symbol == Clutter.KEY_Return || symbol == Clutter.KEY_space) {
            	this.userToggleState();
            }
        }));

        // Restore user state
    	if (this._settings.get_boolean(USER_ENABLED_KEY) && this._settings.get_boolean(RESTORE_KEY)) {
        	this._settings.set_boolean(USER_ENABLED_KEY, false);
            this.userToggleState();
        }
        // Enable caffeine when fullscreen app is running
        if (this._settings.get_boolean(FULLSCREEN_KEY)) {
        	Mainloop.timeout_add_seconds(2, Lang.bind(this, function() {
            	// handle apps in fullcreen
                this._inFullscreenId = global.screen.connect('in-fullscreen-changed', Lang.bind(this, this.toggleFullscreenDisplay));
        	}));
        }
        // handle inhibitors exists, or create inhibitor for custom apps which is running
        this._mayInhibit();
    },
    // cause no identity id exists in metawindow object
    // this method make caffeine to identity per window precisely
    getWindowID: function(window) {
    	if (window.__id != undefined) return window.__id;
    	let app_name = window.get_wm_class_instance();
    	
    	window.__id = app_name+':xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    	    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    	    return v.toString(16);
    	  });
    	
    	return window.__id;
    },
    
    userToggleState: function() {
    	this._settings.set_boolean(USER_ENABLED_KEY, !this._settings.get_boolean(USER_ENABLED_KEY));
    	
        if (!this._settings.get_boolean(USER_ENABLED_KEY)) {
        	this.removeInhibit('user');
        }
        else {
            this.addInhibit('user');
        }
    },
    
    toggleIcon: function(autoSuspend) {
    	if (this._inhibitors.length) { // auto suspend keeping disabled
    		if (this._settings.get_boolean(USER_ENABLED_KEY) && this._icon.icon_name != disableSuspendIcon['user']) { // user mode enable
    			this._icon.icon_name = disableSuspendIcon['user'];
        	} else if (!this._settings.get_boolean(USER_ENABLED_KEY) && this._icon.icon_name != disableSuspendIcon['app']) { // user mode enable
    			this._icon.icon_name = disableSuspendIcon['app'];
        	}
            if (this._settings.get_boolean(SHOW_NOTIFICATIONS_KEY))
                Main.notify(_("Auto suspend and screensaver disabled"));
    		return;
    	}
		
    	if (autoSuspend) {
            if (this._settings.get_boolean(USER_ENABLED_KEY)) 
            	this._icon.icon_name = enableSuspendIcon['user'];
            else this._icon.icon_name = enableSuspendIcon['app'];
            if(this._settings.get_boolean(SHOW_NOTIFICATIONS_KEY))
                Main.notify(_("Auto suspend and screensaver enabled"));
        }
    },
    
    toggleFullscreenWindow: function(window) {
    	let app_id = this.getWindowID(window);
    	if (window.is_fullscreen()) {
    		this.addInhibit(app_id);
    	} else if (!this._inUserApps(window)) {
    		this.removeInhibit(app_id);
    	}
    },
    
    toggleFullscreenDisplay: function(screen) {
    	let window = screen.get_display().get_focus_window();
    	let app_id = this.getWindowID(window);
    	if (window.is_fullscreen()) {
    		this.addInhibit(app_id);
    	} else if (!this._inUserApps(window)) {
    		this.removeInhibit(app_id);
    	}
    },
    
    doApp: function(act, index, app_id, cookie) {
    	switch(act) {
    	case 'add':
            this._apps.push(app_id);
            this._cookies.push(cookie);
    		break;
    	case 'remove':
    		this._apps.splice(index, 1);
            this._cookies.splice(index, 1);
    		break;
    	default:
    		log("Warning: ", act, " undefined!");
    		break;
    	}
    },

    addInhibit: function(app_id) {
        let index = this._apps.indexOf(app_id);
        if (index != -1)  return;
        this._sessionManager.InhibitRemote(app_id,
            0, "Inhibit by %s".format(IndicatorName), INHIBIT_SUSPEND | INHIBIT_IDLE,
            Lang.bind(this, function(cookie) {
            	this.doApp('add', 0, app_id, cookie);
            })
        );
    },

    removeInhibit: function(app_id) {
        let index = this._apps.indexOf(app_id);
        if (index == -1)  return;
        var cookie_remove = this._cookies[index];
    	this.doApp('remove', index);
        this._sessionManager.UninhibitRemote(cookie_remove);
    },
    
    inSuspend: function(flags) {
    	return (flags & MASK_SUSPEND_DISABLE_INHIBIT);
    },
    
    _makeInhibitorProxy: function(path) {
    	return new DBusSessionManagerInhibitorProxy(Gio.DBus.session,
                'org.gnome.SessionManager',
                path);
    },

    _inhibitorAdded: function(proxy, sender, [object]) {
		this._sessionManager.GetInhibitorsRemote(Lang.bind(this, function(){ // call it for ensure getting updated InhibitedActions
			let inhibitor = this._makeInhibitorProxy(object);
			inhibitor.GetFlagsRemote(Lang.bind(this, function(flags){
				if (!this.inSuspend(flags)) return;
				this._inhibitors.push(object);
				this.toggleIcon(false);
			}));
		}));
    },
    
    _inhibitorRemoved: function(proxy, sender, [object]) {
    	// never create session proxy from object directly, 
    	// some actions like logout, switch or shutdown would be delay till reach timeout(default value is 30s)
    	// if you have to get info from inhibitor, call SessionManager method first, like the way in method _inhibitorAdded
    	let index = this._inhibitors.indexOf(object);
    	if (index == -1) return;
    	this._inhibitors.splice(index, 1);
    	this.toggleIcon(true); // try to enable auto suspend
    },
    
    _inUserApps: function(meta_window) {
        let app = Shell.WindowTracker.get_default().get_window_app(meta_window);
        if (app) {
            let app_id = app.get_id();
            let apps = this._settings.get_strv(INHIBIT_APPS_KEY);
            if (apps.indexOf(app_id) != -1) return true;
        }
        
        return false;
    },

    _mayInhibit: function() {
    	// check if some inhibitors exists while caffeine startup
        this._sessionManager.GetInhibitorsRemote(Lang.bind(this, function([inhibitors]){ // call it for ensure getting updated InhibitedActions
        	for (var i in inhibitors) {
	    		if (this._inhibitors.indexOf(inhibitors[i]) != -1) continue;
        		let inhibitor = this._makeInhibitorProxy(inhibitors[i]);
        		inhibitor.GetFlagsRemote(Lang.bind(this, function(flags){
        			if (!this.inSuspend(flags)) return;
    	    		this._inhibitors.push(inhibitors[i]);
    		    	this.toggleIcon(false);
        		}));
	    	}
		}));
        
        // List current windows to check if we need to inhibit
    	Mainloop.timeout_add_seconds(2, Lang.bind(this, function() {
    		global.get_window_actors().map(Lang.bind(this, function(actor) {
    			let window = actor.meta_window;
            	let app_id = this.getWindowID(window);
        		this._windows[app_id] = window.connect('size-changed', Lang.bind(this, this.toggleFullscreenWindow));
        		
                if (this._settings.get_boolean(FULLSCREEN_KEY)) {
    	            // check fullscreen
    	            this._mayFullScreen(global.screen.get_display(), window, true);
                }
	        }));
    	}));
    },
    
    // handle action close from user custom apps
    _mayUserUninhibit: function(shellwm, actor) {
    	let window = actor.meta_window;
    	if (this._inUserApps(window)) {
    		let window_id = this.getWindowID(window);
            this.removeInhibit(window_id);
    	}
    },
    
    // handle user custom apps
    _mayUserInhibit: function(display, window, noRecurse) {
    	let app = Shell.WindowTracker.get_default().get_window_app(window);
        if (!app) {
            if (!noRecurse) {
            	this._mayUserInhibit(display, window, true);
                return false;
            }
            return;
        }
        if (this._inUserApps(window)) {
        	let window_id = this.getWindowID(window);
            this.addInhibit(window_id);
        }
    },
    
    // check if some apps in fullscreen
    _mayFullScreen: function(display, window, noRecurse) {
    	let app_id = this.getWindowID(window);
    	if (window.is_fullscreen()) {
    		this.addInhibit(app_id);
    	}
    },

    destroy: function() {
        // remove all inhibitors created by caffeine
        this._apps.map(Lang.bind(this, function(app_id) {
            this.removeInhibit(app_id);
        }));
        // disconnect from signals
        if (this._settings.get_boolean(FULLSCREEN_KEY)){
            global.screen.disconnect(this._inFullscreenId);
        }
        if (this._inhibitorAddedId) {
            this._sessionManager.disconnectSignal(this._inhibitorAddedId);
            this._inhibitorAddedId = 0;
        }
        if (this._inhibitorRemovedId) {
            this._sessionManager.disconnectSignal(this._inhibitorRemovedId);
            this._inhibitorRemovedId = 0;
        }
        if (this._windowCreatedId) {
            global.screen.get_display().disconnect(this._windowCreatedId);
            this._windowCreatedId = 0;
        }
        if (this._windowDestroyedId) {
            global.window_manager.disconnect(this._windowDestroyedId);
            this._windowDestroyedId = 0;
        }
        this.parent();
    }
});

function init(extensionMeta) {
    Convenience.initTranslations();
    let theme = imports.gi.Gtk.IconTheme.get_default();
    theme.append_search_path(extensionMeta.path + "/icons");
}

function enable() {
    CaffeineIndicator = new Caffeine();
    Main.panel.addToStatusArea(IndicatorName, CaffeineIndicator);
}

function disable() {
    CaffeineIndicator.destroy();
    CaffeineIndicator = null;
}