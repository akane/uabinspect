import { parseAssetBundle } from "@/lib";

export default function Workspace() {
  return <div>
    <input type="file" onChange={(ev) => {
      for (const file of ev.target.files ?? []) {
        parseAssetBundle(file);
      }
    }}/>
  </div>;
}
