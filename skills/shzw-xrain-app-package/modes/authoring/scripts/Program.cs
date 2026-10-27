using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

try
{
    switch (args.FirstOrDefault())
    {
        case "id" when args.Length == 3:
            Console.WriteLine(Appkg.Id(args[1], args[2])); break;
        case "build":
            Console.Error.WriteLine("Standalone package builds are retired. Use the authorized XRain POST /api/application/v1/packages:build endpoint.");
            return 2;
        case "validate" when args.Length == 2:
            var validated = Appkg.Validate(File.ReadAllBytes(args[1]));
            Console.WriteLine(JsonSerializer.Serialize(new { result = "offline-valid", packageId = (string?)validated["packageId"], versionId = (string?)validated["versionId"], digest = (string?)validated["digest"], note = "Server import, tenant preflight and successful operation remain required." })); break;
        case "self-test": Appkg.SelfTest(); break;
        case "convert-field-types" when args.Length == 5:
            var converted = Appkg.ConvertFieldTypes(Appkg.Parse(File.ReadAllBytes(args[1])).AsObject(), args[3], args[4]);
            using (var convertedOutput = new FileStream(args[2], FileMode.CreateNew))
                convertedOutput.Write(JsonSerializer.SerializeToUtf8Bytes(converted, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine("Converted source written. Original source and archives are unchanged."); break;
        case "interop" when args.Length == 3:
            Appkg.Validate(File.ReadAllBytes(args[1]));
            var assemblyPath = Path.GetFullPath(args[2]);
            System.Runtime.Loader.AssemblyLoadContext.Default.Resolving += (_, name) =>
            {
                var path = Path.Combine(Path.GetDirectoryName(assemblyPath)!, name.Name + ".dll");
                return File.Exists(path) ? System.Runtime.Loader.AssemblyLoadContext.Default.LoadFromAssemblyPath(path) : null;
            };
            var assembly = System.Runtime.Loader.AssemblyLoadContext.Default.LoadFromAssemblyPath(assemblyPath);
            var reader = assembly.GetType("XRain.Applications.ApplicationPackageArchiveReader", true)!;
            Appkg.CheckServerCatalog(reader);
            using (var packageStream = File.OpenRead(args[1]))
            {
                var task = (Task)reader.GetMethod("ReadAsync", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)!.Invoke(null, [packageStream, CancellationToken.None])!;
                await task;
            }
            Console.WriteLine("Actual server archive reader accepted the package. This is not a tenant installation."); break;
        default: Console.Error.WriteLine("Usage: id <prefix> <stable-key> | validate <file.appkg> | self-test"); return 2;
    }
    return 0;
}
catch (Exception ex) { Console.Error.WriteLine(ex.GetBaseException().Message); return 1; }

static class Appkg
{
    public static JsonObject ConvertFieldTypes(JsonObject source, string versionId, string version)
    {
        Need(versionId != Text(source["versionId"]) && version != Text(source["version"]), "Conversion requires a new version ID and version.");
        var result = source.DeepClone().AsObject();
        result["versionId"] = versionId;
        result["version"] = version;
        foreach (var record in result["records"]!.AsArray().OfType<JsonObject>().Where(item => Text(item["kind"]) == "BizField"))
        {
            var value = record["values"]!.AsObject();
            var id = Text(record["id"]);
            if (value.ContainsKey("type")) continue;
            Need(value["uiLength"] is null, $"Field {id}: remove the unused legacy uiLength explicitly before conversion.");
            var old = (string?)value["uiType"];
            var physical = ((string?)value["fieldType"] ?? "").Trim().ToLowerInvariant();
            string type;
            if (!string.IsNullOrWhiteSpace(old))
            {
                type = old.Trim() is "multiEnum" or "MultiSelectPicklist" ? "MultiPicklist" : old.Trim();
                Need(FieldTypes.Contains(type), $"Field {id}: unknown legacy type '{old}'.");
            }
            else if (value["valuePicklistId"] is not null) type = "Picklist";
            else if (value["targetEntityDefinitionId"] is not null) type = "Lookup";
            else type = physical switch
            {
                "varchar" or "nvarchar" => "Text",
                "text" or "ntext" => "LongText",
                "int" or "integer" or "bigint" or "smallint" => "Number",
                "numeric" or "decimal" => value["scale"]?.GetValue<int>() > 0 ? "Decimal" : "Number",
                "money" or "smallmoney" => "Money",
                "bit" or "bool" or "boolean" => "Boolean",
                "date" => "Date",
                "datetime" or "datetime2" or "timestamp" or "timestamptz" or "timestamp with time zone" => "DateTime",
                _ => throw new InvalidDataException($"Field {id}: no provably equivalent type for '{physical}'.")
            };
            var compatible = type switch
            {
                "Text" or "Picklist" or "UserRef" or "Lookup" => physical is "varchar" or "nvarchar",
                "LongText" => physical is "text" or "ntext",
                "Number" or "Decimal" or "Money" => physical is "numeric" or "decimal" or "money" or "smallmoney" or "int" or "integer" or "bigint" or "smallint",
                "Boolean" => physical is "bit" or "bool" or "boolean",
                "Date" => physical == "date",
                "DateTime" => physical is "datetime" or "datetime2" or "timestamp" or "timestamptz" or "timestamp with time zone",
                "MultiPicklist" => physical == "jsonb",
                _ => false
            };
            Need(compatible, $"Field {id}: business type conflicts with physical storage.");
            value["type"] = type;
            value.Remove("fieldType"); value.Remove("uiType"); value.Remove("uiLength");
        }
        _ = Build(result);
        return result;
    }

    static readonly HashSet<string> FieldTypes = Words("Text,LongText,Number,Decimal,Money,Date,DateTime,Boolean,Picklist,MultiPicklist,UserRef,Lookup");
    const int EntryLimit = 1024 * 1024, ArchiveLimit = 16 * 1024 * 1024, ExpandedLimit = 32 * 1024 * 1024;
    static readonly JsonObject Kinds = Parse(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "kinds.json"))).AsObject();
    static readonly HashSet<string> Boolean = Words("isActive,isMuted,nullable,unique,searchable,sortable,isSensitive,allowActorPolicyReference,share2AllRoles,manualSharingEnabled,triggersEnabled,isLocalCall,supportsTrigger,readable,updateable,deleteable");
    static readonly HashSet<string> Integer = Words("length,scale,triggerOrder,versionNo");
    static readonly HashSet<string> Objects = Words("contractJson,fieldValues,inputModel,fieldLabelOverrides,presentation,fieldPresentationOverrides,subjectCondition,orchestrationExecutionPolicyOverrides");
    static readonly HashSet<string> Arrays = Words("fieldNames,picklistFields,conditions,sort,cellColorRules,filterItems,toRules,ccRules,bccRules");
    static readonly HashSet<string> Any = Words("inputJson,body,value,searchFields");
    static readonly HashSet<string> NullableRequired = Words("body,subjectCondition,replyToRule,textBodyTemplate,htmlBodyTemplate");
    const string ProtectedUserObjectId = "00457d0cb59a8281762b";
    // Closed, server-reviewed symbolic references. Keep this aligned with
    // XRain TenantApiSystemPermissionCatalog: legacy api.xrain entries are
    // tenant-scoped, while the registered tenantApi entries are global.
    static readonly HashSet<string> TenantApiPermissions = Words("api.xrain.runtime.fields.options,api.xrain.runtime.records.export,api.xrain.runtime.records.import,api.xrain.runtime.records.query,api.xrain.runtime.records.queryAst,api.xrain.runtime.records.distinct,api.xrain.runtime.records.count,api.xrain.runtime.records.single,api.xrain.runtime.records.singleOrDefault,api.xrain.runtime.records.first,api.xrain.runtime.records.firstOrDefault,api.xrain.runtime.record.get,api.xrain.runtime.records.create,api.xrain.runtime.records.batchCreate,api.xrain.runtime.record.update,api.xrain.runtime.records.batchUpdate,api.xrain.runtime.record.delete,api.xrain.runtime.records.batchDelete,api.xrain.metadata.objects.list,api.xrain.metadata.accessibleObjects.list,api.xrain.metadata.entity.describe,api.xrain.metadata.entity.fields,tenantApi.members.profiles.read");
    static readonly HashSet<string> Reserved = new(Words("id,tenantId,ownerId,isDeleted,createdAt,createdById,updatedAt,updatedById,deletedAt,deletedById,externalId,externalSource"), StringComparer.OrdinalIgnoreCase);
    public static void CheckServerCatalog(Type reader)
    {
        var schemas = reader.GetField("Schemas", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)?.GetValue(null)
            as System.Collections.IDictionary ?? throw new InvalidDataException("Cannot inspect this server's archive catalog.");
        Need(Kinds.Select(entry => entry.Key).ToHashSet(StringComparer.Ordinal).SetEquals(schemas.Keys.Cast<string>()), "Server and authoring kinds differ.");
        foreach (System.Collections.DictionaryEntry entry in schemas)
        {
            var local = Kinds[(string)entry.Key]!.AsObject();
            var required = local["required"]!.AsArray().Select(value => Text(value)).ToHashSet(StringComparer.Ordinal);
            var allowed = required.Concat(local["optional"]!.AsArray().Select(value => Text(value))).ToHashSet(StringComparer.Ordinal);
            var serverRequired = (IEnumerable<string>)entry.Value!.GetType().GetProperty("Required")!.GetValue(entry.Value)!;
            var serverAllowed = (IEnumerable<string>)entry.Value.GetType().GetProperty("Allowed")!.GetValue(entry.Value)!;
            Need(required.SetEquals(serverRequired) && allowed.SetEquals(serverAllowed), "Server and authoring properties differ: " + entry.Key);
        }
        Console.WriteLine($"Server catalog matches {schemas.Count} authoring kinds and their required/optional properties.");
    }
    static HashSet<string> Words(string text) => text.Split(',').ToHashSet(StringComparer.Ordinal);
    static void Need(bool condition, string message) { if (!condition) throw new InvalidDataException(message); }
    public static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    public static string Id(string prefix, string key)
    {
        Need(Regex.IsMatch(prefix, @"\A[a-z0-9]{3}\z") && !string.IsNullOrWhiteSpace(key), "A 3-character prefix and stable key are required.");
        return prefix + Hash(Encoding.UTF8.GetBytes(key))[..17];
    }
    static string Text(JsonNode? node) { Need(node is JsonValue && node.GetValueKind() == JsonValueKind.String && !string.IsNullOrWhiteSpace((string?)node), "Expected non-empty string."); return (string)node!; }
    static void CheckId(string id, string prefix) => Need(Regex.IsMatch(id, @"\A[a-z0-9]{20}\z") && id.StartsWith(prefix, StringComparison.Ordinal), "Invalid ID or registered prefix: " + id);
    static void Exact(JsonObject obj, params string[] keys) => Need(obj.Select(x => x.Key).ToHashSet().SetEquals(keys), "Unexpected or missing keys: " + string.Join(',', obj.Select(x => x.Key)));
    public static JsonNode Parse(byte[] bytes)
    {
        using var doc = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 64 });
        CheckDuplicates(doc.RootElement);
        return JsonNode.Parse(bytes)!;
    }
    static void CheckDuplicates(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var seen = new HashSet<string>();
            foreach (var p in element.EnumerateObject()) { Need(seen.Add(p.Name), "Duplicate JSON key."); CheckDuplicates(p.Value); }
        }
        else if (element.ValueKind == JsonValueKind.Array) foreach (var item in element.EnumerateArray()) CheckDuplicates(item);
    }
    public static byte[] Canon(JsonNode node)
    {
        using var doc = JsonDocument.Parse(node.ToJsonString());
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping })) Write(writer, doc.RootElement);
        return stream.ToArray();
    }
    static void Write(Utf8JsonWriter writer, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var p in value.EnumerateObject().OrderBy(p => p.Name, Comparer<string>.Create((a,b) => Encoding.UTF8.GetBytes(a).AsSpan().SequenceCompareTo(Encoding.UTF8.GetBytes(b)))))
            { writer.WritePropertyName(p.Name); Write(writer, p.Value); }
            writer.WriteEndObject();
        }
        else if (value.ValueKind == JsonValueKind.Array) { writer.WriteStartArray(); foreach (var item in value.EnumerateArray()) Write(writer, item); writer.WriteEndArray(); }
        else value.WriteTo(writer);
    }
    static void CheckHeader(JsonObject source)
    {
        CheckId(Text(source["packageId"]), "apg"); CheckId(Text(source["versionId"]), "apv");
        Need(Regex.IsMatch(Text(source["namespace"]), @"\A[a-z][a-z0-9]{1,15}\z"), "Invalid namespace.");
        var version = Text(source["version"]);
        Need(version.Length <= 64 && Regex.IsMatch(version, @"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\z"), "Invalid version.");
        Need(Text(source["label"]).Length <= 256, "Package label is too long.");
        Need(source["records"] is JsonArray, "records must be an array.");
    }
    static IEnumerable<(string Property, string Kind)> References(string kind) => kind switch
    {
        "BizField" => [("entityDefinitionId","BizObject"),("targetEntityDefinitionId","BizObject"),("valuePicklistId","BizPicklist")],
        "BizListView" or "BizRecordType" or "BizSharingRule" => [("refObjectId","BizObject")],
        "BizPicklistItem" => [("refPicklistId","BizPicklist")],
        "BizTrigger" => [("refObjectId","BizObject"),("refOrchestrationId","BizOrchestration")],
        "BizOrchestration" => [("currentVersionId","BizOrchestrationVersion")],
        "BizOrchestrationVersion" or "RoutineTemplate" => [("refOrchestrationId","BizOrchestration")],
        "BizHttpRequest" => [("refConnectorId","BizConnector")],
        "BizHttpInterface" => [("refHttpRequestId","BizHttpRequest"),("refOrchestrationId","BizOrchestration")],
        "PermissionSetItem" => [("refPermissionSetId","AuthenPermissionSet"),("refPermissionId","AuthenPermission")],
        "RuntimeRecord" => [("entityDefinitionId","BizObject")], _ => []
    };
    static void CheckRecords(JsonObject source)
    {
        var records = source["records"]!.AsArray().Select(x => x!.AsObject()).ToArray();
        Need(records.Length < 2048, "Too many records.");
        var byId = new Dictionary<string, JsonObject>();
        foreach (var record in records)
        {
            Exact(record, "id", "kind", "values"); var kind = Text(record["kind"]); var id = Text(record["id"]);
            Need(Kinds.ContainsKey(kind), "Unsupported kind: " + kind); CheckId(id, (string)Kinds[kind]!["prefix"]!);
            Need(byId.TryAdd(id, record), "Duplicate record ID.");
            var schema = Kinds[kind]!; var values = record["values"]!.AsObject();
            var required = schema["required"]!.AsArray().Select(x => (string)x!).ToHashSet();
            var allowed = required.Concat(schema["optional"]!.AsArray().Select(x => (string)x!)).ToHashSet();
            Need(required.All(k => values.ContainsKey(k) && (values[k] != null || NullableRequired.Contains(k))), "Missing required values for " + kind);
            Need(values.All(p => allowed.Contains(p.Key)), "Unsupported values for " + kind);
            if (kind == "RoutineTemplate" && values["timeZoneId"] is not null)
            {
                var zone = Text(values["timeZoneId"]);
                Need(zone == "UTC" || zone.Contains('/'), "Routine region must be an IANA ID.");
                try { _ = TimeZoneInfo.FindSystemTimeZoneById(zone); }
                catch (TimeZoneNotFoundException) { throw new InvalidDataException("Routine region is unavailable."); }
                catch (InvalidTimeZoneException) { throw new InvalidDataException("Routine region is invalid."); }
            }
            foreach (var (key, v) in values)
            {
                if (v == null) continue;
                var type = v.GetValueKind();
                var valid = Boolean.Contains(key) ? type is JsonValueKind.True or JsonValueKind.False :
                    Integer.Contains(key) ? v is JsonValue j && j.TryGetValue<int>(out var n) && n >= (key == "versionNo" ? 1 : 0) :
                    Objects.Contains(key) ? type == JsonValueKind.Object : Arrays.Contains(key) ? type == JsonValueKind.Array :
                    key is "query" or "headers" ? type is JsonValueKind.Object or JsonValueKind.Array : Any.Contains(key) || type == JsonValueKind.String;
                Need(valid, "Invalid type: " + kind + "." + key);
            }
            if (kind == "BizObject")
            {
                var name = Text(values["entityApiName"]);
                Need(name.Length <= 57 && Regex.IsMatch(name, "^[a-z][a-z0-9]{1,15}__[a-z][a-zA-Z0-9]*__c$") && name.StartsWith(Text(source["namespace"]) + "__"), "Invalid managed object name.");
                Need(Regex.IsMatch(Text(values["keyPrefix"]), "^1[a-z0-9]{2}$"), "Invalid object keyPrefix: package objects must use 100 through 1zz.");
            }
            if (kind == "BizField") Need(!Reserved.Contains(Text(values["fieldApiName"])), "Standard fields cannot be declared.");
            if (kind == "BizField")
            {
                var fieldType = Text(values["type"]);
                Need(FieldTypes.Contains(fieldType), "BizField.type must be a canonical business field type.");
                Need((fieldType is "Picklist" or "MultiPicklist") == (values["valuePicklistId"] is not null), "Field type and picklist binding differ.");
                Need((fieldType is "UserRef" or "Lookup") == (values["targetEntityDefinitionId"] is not null), "Field type and lookup binding differ.");
            }
            if (kind == "BizField" && values["unique"]?.GetValue<bool>() == true)
            {
                var type = Text(values["type"]);
                Need(type == "Text" &&
                    values["length"] is JsonValue length && length.TryGetValue<int>(out var size) && size is >= 1 and <= 255,
                    "Unique fields require Text with length between 1 and 255.");
            }
            if (kind == "PermissionSetItem")
            {
                var hasId = values["refPermissionId"] is JsonValue permissionId &&
                    permissionId.GetValueKind() == JsonValueKind.String && !string.IsNullOrWhiteSpace((string?)permissionId);
                var hasName = values["refPermissionName"] is JsonValue permissionName &&
                    permissionName.GetValueKind() == JsonValueKind.String && !string.IsNullOrWhiteSpace((string?)permissionName);
                Need(hasId != hasName, "PermissionSetItem requires exactly one of refPermissionId or refPermissionName.");
                if (hasName) Need(TenantApiPermissions.Contains((string)values["refPermissionName"]!) ||
                    DerivedNames(records).Contains((string)values["refPermissionName"]!, StringComparer.Ordinal) ||
                    records.Any(r => Text(r["kind"]) == "AuthenPermission" && Text(r["values"]!["name"]) == (string)values["refPermissionName"]!), "Unsupported permission reference.");
            }
            if (kind == "AuthenPermissionSet")
            {
                Need(!string.Equals(Text(values["name"]), "xrain-all-employees", StringComparison.OrdinalIgnoreCase),
                    "Packages cannot declare the reserved all-employees permission set.");
                if (values["assignmentAudience"] is not null)
                    Need(Text(values["assignmentAudience"]) is "explicit" or "allEmployees", "Invalid permission-set assignmentAudience.");
            }
            if (kind == "RuntimeRecord") Need(!values["fieldValues"]!.AsObject().Any(p => Reserved.Contains(p.Key)), "Seed must not contain standard fields.");
        }
        foreach (var record in records)
        {
            var kind = Text(record["kind"]); var values = record["values"]!;
            foreach (var (property, targetKind) in References(kind))
            {
                if (values[property] is null) continue;
                var id = Text(values[property]); CheckId(id, (string)Kinds[targetKind]!["prefix"]!);
                var local = byId.TryGetValue(id, out var target) && Text(target["kind"]) == targetKind;
                var protectedUserRef = kind == "BizField" && property == "targetEntityDefinitionId" &&
                    Text(values["type"]) == "UserRef" && id == ProtectedUserObjectId;
                // The protected tenant User object is the single reviewed fixed-definition exception.
                Need(local || protectedUserRef, "Missing/wrong-kind reference: " + property);
            }
            if (kind == "BizOrchestration") Need(Text(byId[Text(values["currentVersionId"])]["values"]!["refOrchestrationId"]) == Text(record["id"]), "Current version belongs to another orchestration.");
            if (kind == "RuntimeRecord") CheckId(Text(record["id"]), Text(byId[Text(values["entityDefinitionId"])]["values"]!["keyPrefix"]));
        }
        Need(!records.Where(r => Text(r["kind"]) == "BizOrchestrationVersion").GroupBy(r => Text(r["values"]!["refOrchestrationId"]) + "/" + r["values"]!["versionNo"]).Any(g => g.Count() > 1), "Duplicate orchestration version number.");
        Need(!records.Where(r => Text(r["kind"]) == "AuthenPermission").GroupBy(r => Text(r["values"]!["name"])).Any(g => g.Count() > 1), "Duplicate permission name.");
        Need(records.Where(r => Text(r["kind"]) == "AuthenPermission").All(r =>
            Regex.IsMatch(Text(r["values"]!["name"]), @"^custom\.[^\s.]+(?:\.[^\s.]+)+$")),
            "Packages may declare only custom.* permissions; the system generates standard permissions.");
    }
    static string DerivedId(string package, string name) => Id("00d", (package + "|derived-permission|" + name).ToLowerInvariant());
    static IEnumerable<string> DerivedNames(IEnumerable<JsonObject> records)
    {
        foreach (var item in records.Where(r => Text(r["kind"]) == "BizHttpInterface"))
        {
            var permission = Text(item["values"]!["permissionName"]);
            if (Regex.IsMatch(permission, @"^httpInterface\.[^\s.]+(?:\.[^\s.]+)?\.execute$", RegexOptions.CultureInvariant))
                yield return permission;
        }
        var objects = records.Where(r => Text(r["kind"]) == "BizObject").ToDictionary(r => Text(r["id"]));
        foreach (var obj in objects.Values)
        {
            var name = Text(obj["values"]!["entityApiName"]);
            foreach (var action in new[] {"read","create","edit","delete","export"}) yield return "platform.entity." + name + "." + action;
            foreach (var field in new[] { "id", "ownerId", "createdById", "createdAt", "updatedById", "updatedAt", "isDeleted", "deletedById", "deletedAt", "tenantId", "externalId", "externalSource" })
                yield return "platform.field." + name + "." + field + ".read";
        }
        foreach (var field in records.Where(r => Text(r["kind"]) == "BizField"))
            if (objects.TryGetValue(Text(field["values"]!["entityDefinitionId"]), out var obj))
            {
                var prefix = "platform.field." + Text(obj["values"]!["entityApiName"]) + "." + Text(field["values"]!["fieldApiName"]) + ".";
                foreach (var action in new[] {"read","create","edit"}) yield return prefix + action;
            }
    }
    public static byte[] Build(JsonObject input)
    {
        var source = input.DeepClone().AsObject(); Exact(source, "packageId","namespace","label","versionId","version","records"); CheckHeader(source);
        var records = source["records"]!.AsArray();
        Need(records.Select(r => Text(r?["id"])).Distinct(StringComparer.Ordinal).Count() == records.Count, "Duplicate record ID.");
        CheckRecords(source);
        var bodies = records.Select(r => r!.AsObject()).OrderBy(r => Text(r["id"]), StringComparer.Ordinal).ToArray();
        var manifest = source.DeepClone().AsObject(); manifest["digest"] = "";
        manifest["records"] = new JsonArray(bodies.Select(r => (JsonNode)new JsonObject { ["id"] = Text(r["id"]), ["kind"] = Text(r["kind"]), ["digest"] = Hash(Canon(r)) }).ToArray());
        manifest["digest"] = PackageDigest(manifest, bodies);
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true))
        {
            Add(zip, "manifest.json", Canon(manifest));
            foreach (var record in bodies) Add(zip, "records/" + Text(record["id"]) + ".json", Canon(record));
        }
        var result = stream.ToArray(); Validate(result); return result;
    }
    static string PackageDigest(JsonObject manifest, IEnumerable<JsonObject> records)
    {
        var copy = manifest.DeepClone().AsObject(); copy["digest"] = "";
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256); hash.AppendData(Canon(copy));
        foreach (var record in records.OrderBy(r => Text(r["id"]), StringComparer.Ordinal)) hash.AppendData(Canon(record));
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }
    static void Add(ZipArchive zip, string name, byte[] bytes)
    {
        Need(bytes.Length <= EntryLimit, "Entry exceeds 1 MiB.");
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal); entry.LastWriteTime = new DateTimeOffset(1980,1,1,0,0,0,TimeSpan.Zero);
        using var output = entry.Open(); output.Write(bytes);
    }
    public static JsonObject Validate(byte[] bytes)
    {
        Need(bytes.Length <= ArchiveLimit, "Archive exceeds 16 MiB.");
        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        Need(zip.Entries.Count is > 0 and <= 2048, "Invalid archive entry count.");
        var files = new Dictionary<string, byte[]>(); long total = 0;
        foreach (var entry in zip.Entries)
        {
            Need(entry.FullName == "manifest.json" || Regex.IsMatch(entry.FullName, "^records/[a-z0-9]{20}\\.json$"), "Unexpected archive path.");
            Need(((entry.ExternalAttributes >> 16) & 0xF000) != 0xA000, "Symlink rejected.");
            Need(entry.Length <= EntryLimit && (total += entry.Length) <= ExpandedLimit, "Expanded size limit exceeded.");
            using var input = entry.Open(); using var output = new MemoryStream();
            var buffer = new byte[8192]; int count;
            while ((count = input.Read(buffer)) > 0) { Need(output.Length + count <= EntryLimit, "Entry size limit exceeded."); output.Write(buffer,0,count); }
            Need(files.TryAdd(entry.FullName, output.ToArray()), "Duplicate entry.");
        }
        Need(files.Remove("manifest.json", out var manifestBytes), "Missing manifest.");
        var manifest = Parse(manifestBytes!).AsObject(); Exact(manifest,"packageId","namespace","label","versionId","version","digest","records"); CheckHeader(manifest);
        var records = new List<JsonObject>();
        foreach (var index in manifest["records"]!.AsArray())
        {
            Exact(index!.AsObject(),"id","kind","digest"); var id = Text(index["id"]);
            Need(files.Remove("records/" + id + ".json", out var raw), "Missing/duplicate indexed file.");
            var record = Parse(raw!).AsObject();
            Need(Text(record["id"]) == id && Text(record["kind"]) == Text(index["kind"]) && Hash(Canon(record)) == Text(index["digest"]), "Record identity/digest mismatch."); records.Add(record);
        }
        Need(files.Count == 0, "Unindexed entries.");
        Need(PackageDigest(manifest,records) == Text(manifest["digest"]), "Manifest digest mismatch.");
        var source = manifest.DeepClone().AsObject(); source["records"] = new JsonArray(records.Select(r => (JsonNode)r.DeepClone()).ToArray()); CheckRecords(source);
        return manifest;
    }
    public static void SelfTest()
    {
        var tests = 0;
        void Pass(bool condition) { Need(condition, "Self-test failed."); tests++; }
        void Reject(Action action) { try { action(); } catch (Exception e) when (e is InvalidDataException or JsonException) { tests++; return; } throw new Exception("Invalid input accepted."); }
        var sample = new JsonObject { ["packageId"] = Id("apg","demo"), ["versionId"] = Id("apv","demo|1.0.0"), ["namespace"] = "demo", ["label"] = "演示", ["version"] = "1.0.0", ["records"] = new JsonArray(new JsonObject { ["id"] = Id("004","demo|object"), ["kind"] = "BizObject", ["values"] = new JsonObject { ["entityApiName"] = "demo__item__c", ["label"] = "项目", ["keyPrefix"] = "19x" } }) };
        var first = Build(sample); Pass(first.SequenceEqual(Build(sample))); Pass(Validate(first)["records"]!.AsArray().Count == 1);
        Reject(() => Id("apg\n", "demo"));
        foreach (var field in new[] { "packageId", "versionId" })
        {
            var invalid = sample.DeepClone().AsObject(); invalid[field] = Text(invalid[field]) + "\n"; Reject(() => Build(invalid));
        }
        foreach (var version in new[] { "1.0.0", "1.0.0-alpha.0+001", "1.0.0-0A", "1.0.0--", "1.0.0+" + new string('a', 58) })
        {
            var valid = sample.DeepClone().AsObject(); valid["version"] = version;
            Pass(Text(Validate(Build(valid))["version"]) == version);
        }
        foreach (var version in new[] { "1.0.0-01", "1.0.0-a..b", "1.0.0+.", "1.0.0+abc..def", "1.0.0\n", "1.0.0+" + new string('a', 59) })
        {
            var invalid = sample.DeepClone().AsObject(); invalid["version"] = version; Reject(() => Build(invalid));
        }
        var invalidNamespace = sample.DeepClone().AsObject(); invalidNamespace["namespace"] = "demo\n"; Reject(() => Build(invalidNamespace));
        var labelBoundary = sample.DeepClone().AsObject(); labelBoundary["label"] = new string('a', 256); Pass(Validate(Build(labelBoundary)) is not null);
        labelBoundary["label"] = new string('a', 257); Reject(() => Build(labelBoundary));
        foreach (var prefix in new[] { "000", "001", "09z", "0zz", "200", "a00", "z9x" })
        {
            var reserved = sample.DeepClone().AsObject();
            reserved["records"]![0]!["values"]!["keyPrefix"] = prefix;
            Reject(() => Build(reserved));
        }
        foreach (var prefix in new[] { "100", "109", "10a", "1zz" })
        {
            var allowed = sample.DeepClone().AsObject();
            allowed["records"]![0]!["values"]!["keyPrefix"] = prefix;
            Pass(Validate(Build(allowed))["records"]!.AsArray().Count == 1);
        }
        var uniqueSample = sample.DeepClone().AsObject();
        uniqueSample["records"]!.AsArray().Add(new JsonObject {
            ["id"] = Id("005", "demo|key"), ["kind"] = "BizField", ["values"] = new JsonObject {
                ["entityDefinitionId"] = Id("004", "demo|object"), ["fieldApiName"] = "key__c",
                ["label"] = "Key", ["type"] = "Text", ["length"] = 100, ["nullable"] = false, ["unique"] = true } });
        Pass(Validate(Build(uniqueSample))["records"]!.AsArray().Count == 2);
        var protectedUserReference = sample.DeepClone().AsObject();
        protectedUserReference["records"]!.AsArray().Add(new JsonObject {
            ["id"] = Id("005", "demo|assignee"), ["kind"] = "BizField", ["values"] = new JsonObject {
                ["entityDefinitionId"] = Id("004", "demo|object"), ["fieldApiName"] = "assignee__c",
                ["label"] = "Assignee", ["type"] = "UserRef", ["targetEntityDefinitionId"] = ProtectedUserObjectId,
                ["length"] = 20, ["nullable"] = false } });
        Pass(Validate(Build(protectedUserReference))["records"]!.AsArray().Count == 2);
        var arbitraryExternalUserReference = protectedUserReference.DeepClone().AsObject();
        arbitraryExternalUserReference["records"]![1]!["values"]!["targetEntityDefinitionId"] = Id("004", "external|object");
        Reject(() => Build(arbitraryExternalUserReference));
        var protectedUserLookup = protectedUserReference.DeepClone().AsObject();
        protectedUserLookup["records"]![1]!["values"]!["type"] = "Lookup";
        Reject(() => Build(protectedUserLookup));
        var legacy = uniqueSample.DeepClone().AsObject();
        var legacyField = legacy["records"]![1]!["values"]!.AsObject();
        legacyField.Remove("type"); legacyField["fieldType"] = "varchar"; legacyField["uiType"] = "Text";
        var legacyBytes = Canon(legacy);
        var converted = ConvertFieldTypes(legacy, Id("apv", "demo|2.0.0"), "2.0.0");
        Pass(Canon(legacy).SequenceEqual(legacyBytes));
        Pass(Text(converted["records"]![1]!["values"]!["type"]) == "Text"
            && converted["records"]![1]!["values"]!["uiType"] is null);
        Pass(Validate(Build(converted))["records"]!.AsArray().Count == 2);
        Reject(() => ConvertFieldTypes(legacy, Text(legacy["versionId"]), "2.0.0"));
        legacyField["uiType"] = "unknown";
        Reject(() => ConvertFieldTypes(legacy, Id("apv", "demo|2.0.0"), "2.0.0"));
        legacyField["uiType"] = "Boolean";
        Reject(() => ConvertFieldTypes(legacy, Id("apv", "demo|2.0.0"), "2.0.0"));
        legacyField["uiType"] = "Text"; legacyField["uiLength"] = 100;
        Reject(() => ConvertFieldTypes(legacy, Id("apv", "demo|2.0.0"), "2.0.0"));
        var legacyMulti = sample.DeepClone().AsObject();
        legacyMulti["records"]!.AsArray().Add(new JsonObject { ["id"] = Id("006", "demo|choices"), ["kind"] = "BizPicklist",
            ["values"] = new JsonObject { ["name"] = "choices", ["label"] = "Choices", ["isActive"] = true } });
        legacyMulti["records"]!.AsArray().Add(new JsonObject { ["id"] = Id("005", "demo|multi"), ["kind"] = "BizField",
            ["values"] = new JsonObject { ["entityDefinitionId"] = Id("004", "demo|object"), ["fieldApiName"] = "choices__c",
                ["label"] = "Choices", ["nullable"] = true, ["fieldType"] = "jsonb", ["uiType"] = "multiEnum",
                ["valuePicklistId"] = Id("006", "demo|choices") } });
        var convertedMulti = ConvertFieldTypes(legacyMulti, Id("apv", "demo|2.0.0"), "2.0.0");
        Pass(Text(convertedMulti["records"]![2]!["values"]!["type"]) == "MultiPicklist");
        Pass(Text(convertedMulti["records"]![2]!["id"]) == Text(legacyMulti["records"]![2]!["id"]));
        Pass(Validate(Build(convertedMulti))["records"]!.AsArray().Count == 3);
        var tenantApiSample = sample.DeepClone().AsObject();
        tenantApiSample["records"]!.AsArray().Add(new JsonObject
        {
            ["id"] = Id("00e", "demo|member"), ["kind"] = "AuthenPermissionSet",
            ["values"] = new JsonObject { ["label"] = "Member", ["name"] = "member", ["isMuted"] = false }
        });
        tenantApiSample["records"]!.AsArray().Add(new JsonObject
        {
            ["id"] = Id("00f", "demo|member|create"), ["kind"] = "PermissionSetItem",
            ["values"] = new JsonObject { ["refPermissionSetId"] = Id("00e", "demo|member"), ["refPermissionName"] = "api.xrain.runtime.records.create" }
        });
        Pass(Validate(Build(tenantApiSample))["records"]!.AsArray().Count == 3);
        var importApiSample = tenantApiSample.DeepClone().AsObject();
        importApiSample["records"]![2]!["values"]!["refPermissionName"] = "api.xrain.runtime.records.import";
        Pass(Validate(Build(importApiSample))["records"]!.AsArray().Count == 3);
        var importEntry = sample.DeepClone().AsObject();
        var importId = Id("01p", "demo|import"); var importVersion = Id("01r", "demo|import|1");
        importEntry["records"]!.AsArray().Add(new JsonObject { ["id"] = importId, ["kind"] = "BizOrchestration", ["values"] = new JsonObject { ["name"] = "demoImport", ["label"] = "Import", ["isActive"] = true, ["currentVersionId"] = importVersion } });
        importEntry["records"]!.AsArray().Add(new JsonObject { ["id"] = importVersion, ["kind"] = "BizOrchestrationVersion", ["values"] = new JsonObject { ["refOrchestrationId"] = importId, ["versionNo"] = 1, ["inputModel"] = JsonNode.Parse("""{"fields":[],"import":{"version":1,"inputColumns":[],"transform":true,"recordMaintenance":true}}"""), ["source"] = "function execute(ctx) { return { rows: ctx.input.rows, issues: [] }; }" } });
        var importManifest = Validate(Build(importEntry));
        Pass(importManifest["records"]!.AsArray().Count == 3);
        importEntry["records"]![2]!["values"]!["import"] = new JsonObject { ["version"] = 1 };
        Reject(() => Build(importEntry));
        tenantApiSample["records"]![1]!["values"]!["assignmentAudience"] = "allEmployees";
        Pass(Validate(Build(tenantApiSample))["records"]!.AsArray().Count == 3);
        tenantApiSample["records"]![1]!["values"]!["assignmentAudience"] = "everyone";
        Reject(() => Build(tenantApiSample));
        tenantApiSample["records"]![1]!["values"]!["assignmentAudience"] = "explicit";
        tenantApiSample["records"]![1]!["values"]!["name"] = "XRAIN-ALL-EMPLOYEES";
        Reject(() => Build(tenantApiSample));
        tenantApiSample["records"]![1]!["values"]!["name"] = "member";
        var generatedTenantApi = tenantApiSample.DeepClone().AsObject();
        generatedTenantApi["records"]![2]!["values"]!["refPermissionName"] = "tenantApi.members.profiles.read";
        Pass(Validate(Build(generatedTenantApi))["records"]!.AsArray().Count == 3);
        foreach (var name in new[] { "tenantApi.security.directory.read", "tenantApi.security.users.list", "tenantApi.security.permissions.list", "tenantApi.security.permissionSets.list" })
        {
            generatedTenantApi["records"]![2]!["values"]!["refPermissionName"] = name;
            Reject(() => Build(generatedTenantApi));
        }
        var standardReference = tenantApiSample.DeepClone().AsObject();
        foreach (var name in new[] { "httpInterface.messages.send.execute", "httpInterface.send.execute" })
        {
            var interfaces = new[] { new JsonObject { ["kind"] = "BizHttpInterface", ["values"] = new JsonObject { ["permissionName"] = name } } };
            Pass(DerivedNames(interfaces).Single() == name);
            interfaces[0]["values"]!["permissionName"] = "platform.security.manage";
            Pass(!DerivedNames(interfaces).Any());
        }
        standardReference["records"]![2]!["values"]!["refPermissionName"] = "platform.entity.demo__item__c.read";
        Pass(Validate(Build(standardReference))["records"]!.AsArray().Count == 3);
        standardReference["records"]![2]!["values"]!["refPermissionName"] = "platform.field.demo__item__c.secret__c.export";
        Reject(() => Build(standardReference));
        var standardId = tenantApiSample.DeepClone().AsObject();
        standardId["records"]![2]!["values"]!.AsObject().Remove("refPermissionName");
        standardId["records"]![2]!["values"]!["refPermissionId"] = DerivedId(Text(sample["packageId"]), "platform.entity.demo__item__c.read");
        Reject(() => Build(standardId));
        var declaredStandard = sample.DeepClone().AsObject();
        declaredStandard["records"]!.AsArray().Add(new JsonObject { ["id"] = Id("00d", "invalid-standard"), ["kind"] = "AuthenPermission",
            ["values"] = new JsonObject { ["name"] = "platform.entity.demo__item__c.read", ["label"] = "Read", ["isMuted"] = false } });
        Reject(() => Build(declaredStandard));
        var customReference = tenantApiSample.DeepClone().AsObject();
        customReference["records"]!.AsArray().Add(new JsonObject { ["id"] = Id("00d", "custom"), ["kind"] = "AuthenPermission",
            ["values"] = new JsonObject { ["name"] = "custom.demo.approve", ["label"] = "Approve", ["isMuted"] = false } });
        customReference["records"]![2]!["values"]!["refPermissionName"] = "custom.demo.approve";
        Pass(Validate(Build(customReference))["records"]!.AsArray().Count == 4);
        var sensitiveReference = tenantApiSample.DeepClone().AsObject();
        sensitiveReference["records"]!.AsArray().Add(uniqueSample["records"]![1]!.DeepClone());
        sensitiveReference["records"]![3]!["values"]!["isSensitive"] = true;
        sensitiveReference["records"]![2]!["values"]!["refPermissionName"] = "platform.field.demo__item__c.key__c.unmask";
        Reject(() => Build(sensitiveReference));
        sensitiveReference["records"]![3]!["values"]!["isSensitive"] = false;
        Reject(() => Build(sensitiveReference));
        var invalidTenantApi = tenantApiSample.DeepClone().AsObject();
        invalidTenantApi["records"]![2]!["values"]!["refPermissionName"] = "api.xrain.admin.tenants.create";
        Reject(() => Build(invalidTenantApi));
        foreach (var invalidType in new[] { "text", "jsonb", "integer", "char", "nchar" })
        {
            var invalid = uniqueSample.DeepClone().AsObject(); invalid["records"]![1]!["values"]!["type"] = invalidType;
            Reject(() => Build(invalid));
        }
        foreach (var invalidLength in new[] { 0, 256 })
        {
            var invalid = uniqueSample.DeepClone().AsObject(); invalid["records"]![1]!["values"]!["length"] = invalidLength;
            Reject(() => Build(invalid));
        }
        var invalidBoolean = uniqueSample.DeepClone().AsObject(); invalidBoolean["records"]![1]!["values"]!["unique"] = "true";
        Reject(() => Build(invalidBoolean));
        var functionContract = sample.DeepClone().AsObject();
        functionContract["records"]!.AsArray().Add(new JsonObject { ["id"] = Id("01s", "demo|echo"), ["kind"] = "BizOrchestrationFunction",
            ["values"] = new JsonObject { ["key"] = "tenant.demoEcho", ["label"] = "Echo", ["helpText"] = "Echo a structured value", ["signature"] = "(input) => result",
                ["source"] = "function(ctx) { return ctx.input; }", ["isActive"] = true,
                ["contractJson"] = new JsonObject { ["schemaVersion"] = 1, ["input"] = new JsonObject { ["type"] = "object", ["fields"] = new JsonArray() },
                    ["output"] = new JsonObject { ["type"] = "object", ["fields"] = new JsonArray() } } } });
        Pass(Validate(Build(functionContract))["records"]!.AsArray().Count == sample["records"]!.AsArray().Count + 1);
        functionContract["records"]!.AsArray().Last()!["values"]!["contractJson"] = "invalid-string";
        Reject(() => Build(functionContract));
        Pass(Encoding.UTF8.GetString(Canon(Parse(Encoding.UTF8.GetBytes("{\"b\":1.2300,\"a\":\"中文\"}")))) == "{\"a\":\"中文\",\"b\":1.2300}");
        Reject(() => Parse(Encoding.UTF8.GetBytes("{\"x\":1,\"x\":2}")));
        var bad = sample.DeepClone().AsObject(); bad["tenantId"] = "forbidden"; Reject(() => Build(bad));
        bad = sample.DeepClone().AsObject(); bad["records"]![0]!["values"]!["ownerId"] = "forbidden"; Reject(() => Build(bad));
        bad = sample.DeepClone().AsObject(); bad["records"]![0]!["id"] = Id("005","wrong"); Reject(() => Build(bad));
        bad = sample.DeepClone().AsObject(); bad["records"]!.AsArray().Add(bad["records"]![0]!.DeepClone()); Reject(() => Build(bad));
        bad = sample.DeepClone().AsObject(); bad["records"]![0]!["values"]!["entityApiName"] = "other__item__c"; Reject(() => Build(bad));
        bad = sample.DeepClone().AsObject(); bad["records"]![0]!["values"]!["triggersEnabled"] = "yes"; Reject(() => Build(bad));
        using var altered = new MemoryStream();
        using (var zip = new ZipArchive(altered,ZipArchiveMode.Create,true)) Add(zip,"../manifest.json",Encoding.UTF8.GetBytes("{}"));
        Reject(() => Validate(altered.ToArray()));
        byte[] Repack(string mode)
        {
            using var destination = new MemoryStream();
            using (var zip = new ZipArchive(destination, ZipArchiveMode.Create, true))
            using (var original = new ZipArchive(new MemoryStream(first), ZipArchiveMode.Read))
            {
                foreach (var entry in original.Entries)
                {
                    using var input = entry.Open(); using var content = new MemoryStream(); input.CopyTo(content);
                    var data = content.ToArray();
                    if (entry.FullName == "manifest.json" && mode == "digest")
                    { var value = Parse(data).AsObject(); value["digest"] = new string('0',64); data = Canon(value); }
                    if (entry.FullName.StartsWith("records/004") && mode == "content")
                    { var value = Parse(data).AsObject(); value["values"]!["label"] = "changed"; data = Canon(value); }
                    Add(zip,entry.FullName,data);
                    if (entry.FullName == "manifest.json" && mode == "duplicate") Add(zip,entry.FullName,data);
                }
                if (mode == "extra") Add(zip,"records/00600000000000000001.json",Encoding.UTF8.GetBytes("{}"));
            }
            return destination.ToArray();
        }
        foreach (var mode in new[] { "digest","content","duplicate","extra" }) Reject(() => Validate(Repack(mode)));
        Console.WriteLine($"{tests} offline self-tests passed; no network or database accessed.");
    }
}
