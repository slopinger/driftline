{
  description = "Driftline OpenAPI migration explorer and CLI";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }: let
    systems = [ "x86_64-linux" "aarch64-linux" ];
    eachSystem = nixpkgs.lib.genAttrs systems;
  in {
    packages = eachSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      default = pkgs.stdenvNoCC.mkDerivation {
        pname = "driftline";
        version = "0.1.0";
        src = self;
        nativeBuildInputs = [ pkgs.makeWrapper ];
        nativeCheckInputs = [ pkgs.nodejs ];
        dontBuild = true;
        doCheck = true;
        checkPhase = "node --test test/*.test.mjs";
        installPhase = ''
          mkdir -p $out/share/driftline $out/bin
          cp -r bin web $out/share/driftline/
          makeWrapper ${pkgs.nodejs}/bin/node $out/bin/driftline \
            --add-flags $out/share/driftline/bin/driftline.mjs
        '';
        meta = {
          description = "OpenAPI change impact explorer and migration reports";
          license = pkgs.lib.licenses.mit;
          mainProgram = "driftline";
          platforms = systems;
        };
      };
    });
    checks = eachSystem (system: { package = self.packages.${system}.default; });
    devShells = eachSystem (system: {
      default = nixpkgs.legacyPackages.${system}.mkShell {
        packages = with nixpkgs.legacyPackages.${system}; [ nodejs python3 ];
      };
    });
    nixosModules.default = { config, lib, pkgs, ... }: let
      cfg = config.services.driftline;
    in {
      options.services.driftline = {
        enable = lib.mkEnableOption "Driftline static website served by Caddy";
        package = lib.mkOption {
          type = lib.types.package;
          default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          description = "Driftline package containing share/driftline/web.";
        };
        domain = lib.mkOption { type = lib.types.str; description = "Public website domain."; };
      };
      config = lib.mkIf cfg.enable {
        services.caddy.enable = true;
        services.caddy.virtualHosts.${cfg.domain}.extraConfig = ''
          root * ${cfg.package}/share/driftline/web
          file_server
        '';
      };
    };
  };
}
