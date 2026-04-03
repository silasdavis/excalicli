{
  lib,
  stdenv,
  bun,
  makeWrapper,
  writableTmpDirAsHomeHook,
  src ? ./.,
  node_modules_hash ? throw "node_modules_hash must be provided for your platform, build once with lib.fakeHash to obtain it",
}:
let
  pname = "excalicli";
  version = "0.1.0";

  node_modules = stdenv.mkDerivation {
    pname = "${pname}-node_modules";
    inherit version src;

    nativeBuildInputs = [
      bun
      writableTmpDirAsHomeHook
    ];

    dontConfigure = true;

    buildPhase = ''
      runHook preBuild

      export BUN_INSTALL_CACHE_DIR=$(mktemp -d)

      bun install \
        --force \
        --frozen-lockfile \
        --ignore-scripts \
        --no-progress

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out/node_modules
      cp -R ./node_modules $out

      runHook postInstall
    '';

    dontFixup = true;

    outputHash = node_modules_hash;
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
  };
in
stdenv.mkDerivation {
  inherit pname version src;

  nativeBuildInputs = [
    bun
    makeWrapper
  ];

  configurePhase = ''
    runHook preConfigure

    cp -R ${node_modules}/node_modules .

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild

    bun build \
      --compile \
      --target=bun \
      --minify \
      --sourcemap \
      --external canvas \
      src/cli.ts \
      --outfile excalicli

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin
    cp excalicli $out/bin/

    wrapProgram $out/bin/excalicli \
      --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath [ stdenv.cc.cc ]}"

    runHook postInstall
  '';

  # strip removes the JS bundle from the binary
  dontStrip = true;

  meta = {
    description = "CLI and MCP server for Excalidraw diagrams";
    homepage = "https://github.com/silasdavis/excalicli";
    license = lib.licenses.mit;
    mainProgram = "excalicli";
    platforms = [ "x86_64-linux" ];
  };
}
