#!/bin/sh
# Written by the nx-rust test harness (cargo-wrapper.ts) from log-cargo.sh.
#
# The `cargo` that cargo-wrapper.ts puts on PATH, once it has replaced each
# placeholder between @ signs with a path: of Node, of log-cargo.cjs, of the
# real cargo, of the real cargo's folder and of the log.
#
# A plain call appends its JSON line to the log here and then replaces this
# shell with the real cargo, so that no Node process starts. Every other call
# goes to log-cargo.cjs, which logs it in the same way, runs the real cargo
# and also does what the rare calls need. A call is plain when
#
# - none of the variables that this script assigns, nx_rust_*, is set in its
#   environment, so that the script changes nothing that cargo would get;
# - neither NX_RUST_TEST_CARGO_VERSION nor NX_RUST_TEST_HOLD_CARGO has a
#   value: only log-cargo.cjs acts on them;
# - the absolute folder that this script was started from is an entry of
#   PATH: the call found the wrapper through PATH, so PATH came from the
#   caller. A shell that inherits no PATH searches folders of its own
#   instead, which cargo would get behind its folder; log-cargo.cjs gives
#   cargo its folder only, as it does for an empty PATH;
# - its folder, every argument and the value of RUSTUP_AUTO_INSTALL hold
#   only printable ASCII characters other than `"` and `\`, so that
#   JSON.stringify writes each of them unchanged between quotes;
# - PWD is the folder that Node's process.cwd() returns: absolute, without an
#   empty, `.` or `..` component, without a symbolic link, because a shell
#   keeps an inherited PWD that names its folder through a link, and naming
#   the folder this process is in, which exists and can be read;
# - and its line takes at most 512 bytes with the newline. The shell's printf
#   collects its output in a buffer and writes it when the buffer is full or
#   the command ends, so a line shorter than the buffer goes out with one
#   write(2); with O_APPEND, lines that processes append at the same moment
#   then neither interleave nor overwrite each other, as with log-cargo.cjs,
#   which writes each line at once. The buffers seen were 1008 bytes in bash
#   3.2 with its own allocator, 4096 in bash 5 and more in dash; 512 bytes is
#   the least that POSIX allows for PIPE_BUF.
#
# The real cargo gets this shell's environment with its own folder first on
# PATH, as log-cargo.cjs gives it: cargo then runs the rustc of its own
# toolchain, and a bare `cargo` that a build script runs finds the real cargo.
# Bash, unlike dash, stops exporting `_`, the last command of the shell that
# started the wrapper, once it has run a command itself, so under bash
# neither cargo nor log-cargo.cjs gets an inherited `_`.
#
# Only what a POSIX sh has is used, so that it runs as /bin/sh on Linux and
# macOS: case, test, printf, exec and parameter expansion.

case ${nx_rust_plain+x}${nx_rust_safe+x}${nx_rust_folder+x}${nx_rust_line+x}${nx_rust_comma+x}${nx_rust_arg+x} in
?*) exec @NODE@ @SCRIPT@ @CARGO@ @LOG@ "$@" ;;
esac

nx_rust_plain=yes
if [ -n "${NX_RUST_TEST_CARGO_VERSION-}${NX_RUST_TEST_HOLD_CARGO-}" ]; then
  nx_rust_plain=
fi

case $0 in
/*) ;;
*) nx_rust_plain= ;;
esac
case :${PATH-}: in
*:"${0%/*}":*) ;;
*) nx_rust_plain= ;;
esac

# Every printable ASCII character but `"` and `\`, listed one by one because
# a range depends on the locale, with `]` first and `-` last, where both stand
# for themselves in a bracket expression.
nx_rust_safe=']abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !#$%&'\''()*+,./:;<=>?@[^_`{|}~-'
case "${PWD-}/${RUSTUP_AUTO_INSTALL-}/$*" in
*[!$nx_rust_safe]*) nx_rust_plain= ;;
esac

case ${PWD-} in
/) ;;
*/ | *//* | */./* | */. | */../* | */..) nx_rust_plain= ;;
/*)
  nx_rust_folder=$PWD
  while [ -n "$nx_rust_plain" ] && [ -n "$nx_rust_folder" ]; do
    if [ -h "$nx_rust_folder" ]; then
      nx_rust_plain=
    fi
    nx_rust_folder=${nx_rust_folder%/*}
  done
  ;;
*) nx_rust_plain= ;;
esac

if [ -n "$nx_rust_plain" ]; then
  if [ "$PWD" -ef . ] && [ -r . ]; then
    :
  else
    nx_rust_plain=
  fi
fi

if [ -n "$nx_rust_plain" ]; then
  nx_rust_line="{\"cwd\":\"$PWD\",\"args\":["
  nx_rust_comma=
  for nx_rust_arg in "$@"; do
    nx_rust_line="$nx_rust_line$nx_rust_comma\"$nx_rust_arg\""
    nx_rust_comma=,
  done
  if [ -n "${RUSTUP_AUTO_INSTALL+set}" ]; then
    nx_rust_line="$nx_rust_line],\"env\":{\"RUSTUP_AUTO_INSTALL\":\"$RUSTUP_AUTO_INSTALL\"}}"
  else
    nx_rust_line="$nx_rust_line],\"env\":{\"RUSTUP_AUTO_INSTALL\":null}}"
  fi
  if [ "${#nx_rust_line}" -ge 512 ]; then
    nx_rust_plain=
  fi
fi

if [ -n "$nx_rust_plain" ]; then
  printf '%s\n' "$nx_rust_line" >>@LOG@ || exit 1
  unset nx_rust_plain nx_rust_safe nx_rust_folder nx_rust_line nx_rust_comma nx_rust_arg
  PATH=@CARGO_FOLDER@:$PATH
  export PATH
  exec @CARGO@ "$@"
fi

unset nx_rust_plain nx_rust_safe nx_rust_folder nx_rust_line nx_rust_comma nx_rust_arg
exec @NODE@ @SCRIPT@ @CARGO@ @LOG@ "$@"
