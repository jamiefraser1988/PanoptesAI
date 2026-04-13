{pkgs}: {
  deps = [
    pkgs.gcc
    pkgs.stdenv.cc.cc.lib
  ];
}
