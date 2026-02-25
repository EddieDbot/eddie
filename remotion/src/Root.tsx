import { Composition, registerRoot } from "remotion";
import {
  NewsShort,
  NewsShortSchema,
  calculateMetadata,
} from "./compositions/NewsShort";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="NewsShort"
        component={NewsShort}
        calculateMetadata={calculateMetadata}
        durationInFrames={1800}
        fps={30}
        width={1080}
        height={1920}
        schema={NewsShortSchema}
        defaultProps={{
          hook: "OpenAI just dropped something massive",
          sections: [
            {
              text: "Today OpenAI announced GPT-5, their most powerful model yet.",
              durationSec: 8,
              visual: "OpenAI logo with glowing text",
            },
            {
              text: "It scores 95% on benchmarks, beating every other model.",
              durationSec: 8,
              visual: "Bar chart showing benchmark scores",
            },
            {
              text: "Available to Plus users starting today.",
              durationSec: 6,
              visual: "ChatGPT interface screenshot",
            },
          ],
          cta: "Follow for daily AI updates",
          title: "OpenAI Drops GPT-5",
          source: "OpenAI Blog",
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
