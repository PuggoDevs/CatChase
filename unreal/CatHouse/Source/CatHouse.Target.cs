using UnrealBuildTool;

public class CatHouseTarget : TargetRules
{
	public CatHouseTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("CatHouse");
	}
}
