{
  description = "Dev shell for dryvist Cribl pack template — delegates to nix-devenv's typescript subflake.";

  # Pin to the typescript SUBFLAKE (?dir=shells/typescript), not the root
  # nix-devenv flake. The root flake imports cachix/devenv to support its
  # Python/AI shells (ai-dev, orchestrator, mlx-server), which drags in a
  # huge transitive tree (cachix x3, gitignore x5, nixpkgs x5, etc.). The
  # typescript subflake has exactly one input — nixpkgs — and the lock file
  # stays tiny. The `follows` declaration ensures even that one input shares
  # our root nixpkgs rather than pulling its own copy.
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-25.11-darwin";
    nix-devenv = {
      url = "github:JacobPEvans/nix-devenv?dir=shells/typescript";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      nix-devenv,
      ...
    }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      # The subflake exposes its sole shell as `default`.
      devShells = forAllSystems (system: {
        default = nix-devenv.devShells.${system}.default;
      });
    };
}
