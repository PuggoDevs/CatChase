using UnrealBuildTool;

public class CatHouse : ModuleRules
{
	public CatHouse(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "InputCore",
			"Slate", "SlateCore",
			"ProceduralMeshComponent",
			"Json",
			"AudioMixer", "AudioExtensions"
		});
	}
}
