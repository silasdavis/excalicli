{ self }:
{
  config,
  lib,
  options,
  pkgs,
  ...
}:
let
  inherit (lib)
    literalExpression
    mkEnableOption
    mkIf
    mkMerge
    mkOption
    types
    ;

  system = pkgs.stdenv.hostPlatform.system;
  defaultPackage =
    if lib.hasAttrByPath [ system "default" ] self.packages then
      self.packages.${system}.default
    else
      throw "excalicli is not packaged for ${system}; set `programs.excalicli.package` explicitly";

  hasMcpModule =
    lib.hasAttrByPath [
      "programs"
      "mcp"
      "enable"
    ] options
    && lib.hasAttrByPath [
      "programs"
      "mcp"
      "servers"
    ] options;

  hasClaudeCodeModule =
    lib.hasAttrByPath [
      "programs"
      "claude-code"
      "enable"
    ] options
    && lib.hasAttrByPath [
      "programs"
      "claude-code"
      "enableMcpIntegration"
    ] options
    && lib.hasAttrByPath [
      "programs"
      "claude-code"
      "package"
    ] options;

  hasCodexModule =
    lib.hasAttrByPath [
      "programs"
      "codex"
      "enable"
    ] options
    && lib.hasAttrByPath [
      "programs"
      "codex"
      "enableMcpIntegration"
    ] options;

  cfg = config.programs.excalicli;
in
{
  options.programs.excalicli = {
    enable = mkEnableOption "excalicli";

    package = mkOption {
      type = types.package;
      default = defaultPackage;
      defaultText = literalExpression "inputs.excalicli.packages.${system}.default";
      description = ''
        Package to install and register as the `excalicli` MCP server.
      '';
    };
  };

  config = mkIf cfg.enable (
    mkMerge [
      {
        assertions = [
          {
            assertion = hasMcpModule;
            message = ''
              The excalicli Home Manager module requires a Home Manager version
              that provides `programs.mcp`.
            '';
          }
        ];

        home.packages = [ cfg.package ];
      }

      (mkIf hasMcpModule {
        programs.mcp.enable = lib.mkDefault true;
        programs.mcp.servers.excalicli = {
          command = lib.getExe cfg.package;
          args = [ "mcp" ];
        };
      })

      (mkIf (
        hasClaudeCodeModule
        && config.programs.claude-code.enable
        && config.programs.claude-code.package != null
      ) {
        programs.claude-code.enableMcpIntegration = lib.mkDefault true;
      })

      (mkIf (hasCodexModule && config.programs.codex.enable) {
        programs.codex.enableMcpIntegration = lib.mkDefault true;
      })
    ]
  );
}
