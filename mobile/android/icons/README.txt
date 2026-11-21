Nova - Android launcher icons
=============================

Copy the "android" folder from this archive over the "android" folder in
your project root, letting it merge/overwrite. Files landed:

  android/app/src/main/res/mipmap-mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi/
      ic_launcher.png            legacy square icon
      ic_launcher_round.png      legacy round icon
      ic_launcher_foreground.png adaptive icon foreground layer
  android/app/src/main/res/mipmap-anydpi-v26/
      ic_launcher.xml            adaptive icon definition
      ic_launcher_round.xml
  android/app/src/main/res/values/
      ic_launcher_background.xml background colour (#0E0E12)

Afterwards, in Android Studio:
  Build -> Clean Project, then Run.
If the old icon lingers, uninstall the app from the device first --
Android caches launcher icons aggressively.
