# This extension is not maintained anymore. New maintainers are welcome!

# And, many thanks to @eonpatapon for creating this awesome extension

## gnome-shell-extension-caffeine-plus

Fill the cup to inhibit auto suspend and screensaver.

This extension supports gnome-shell 3.4 to 3.32:

    * master: 3.2
    * gnome-shell-3.10-3.30: 3.10 -> 3.30
    * gnome-shell-before-3.10: 3.4 -> 3.8

![Screenshot](https://github.com/qunxyz/gnome-shell-extension-caffeine/raw/master/screenshot.png)

![Preferences](https://github.com/qunxyz/gnome-shell-extension-caffeine/raw/master/screenshot-prefs.png)

White: Empty cup = normal auto suspend and screensaver. Filled cup = auto suspend and screensaver off.
Green: No empty cup status. Filled cup = auto suspend and screensaver off always.

## Installation from e.g.o

seems e.g.o did not approved my version, waiting long long time but pending only. 
following installation from git as well

https://extensions.gnome.org/extension/517/caffeine/

## Installation from git

    git clone git://github.com/qunxyz/gnome-shell-extension-caffeine.git
    cd gnome-shell-extension-caffeine
    ./build.sh
    cp -r caffeine-plus@patapon.info ~/.local/share/gnome-shell/extensions

Restart the shell and then enable the extension.

## Development

    git clone git://github.com/qunxyz/gnome-shell-extension-caffeine.git
    cd gnome-shell-extension-caffeine
    ./build.sh
    ln -s caffeine-plus@patapon.info ~/.local/share/gnome-shell/extensions
   	 CTRL+F2, and enter r to Restart the shell. then enable the extension.
    
    modified extension.js and execute below shell 
    ./build.sh

	CTRL+F2, and enter r to Restart the shell.
