{
  description = "CLI and MCP server for Excalidraw diagrams";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      # Per-platform node_modules hashes (fixed-output derivation).
      # To add a new platform: set its hash to nixpkgs.lib.fakeHash, build once,
      # and replace with the hash from the error message.
      node_modules_hashes = {
        x86_64-linux = "sha256-BU6Gt6wYqNG9EkZQ2xFZDQnTZw+OYhtDQ/oHMK8jgvc=";
      };

      supportedSystems = builtins.attrNames node_modules_hashes;

      forAllSystems = f: nixpkgs.lib.genAttrs supportedSystems (system: f {
        pkgs = nixpkgs.legacyPackages.${system};
        inherit system;
      });
    in
    {
      packages = forAllSystems ({ pkgs, system }: {
        default = pkgs.callPackage ./package.nix {
          src = ./.;
          node_modules_hash = node_modules_hashes.${system};
        };
      });

      overlays.default = final: prev: {
        excalicli = self.packages.${final.stdenv.hostPlatform.system}.default;
      };
    };
}
