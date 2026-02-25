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
          hook: "OpenAI just dropped GPT-5. The AI race just changed.",
          foreshadow: "Here's what this actually costs you.",
          body: [
            "Every major tech company is now scrambling to respond.",
            "But the pricing model revealed is unlike anything before.",
          ],
          payoff: "The free tier is gone.",
          emotionTarget: "WTF" as const,
          title: "OpenAI Drops GPT-5",
          source: "OpenAI Blog",
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
