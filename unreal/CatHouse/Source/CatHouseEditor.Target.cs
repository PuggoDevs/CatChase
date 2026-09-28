using UnrealBuildTool;

public class CatHouseEditorTarget : TargetRules
{
	public CatHouseEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("CatHouse");
	}
}
