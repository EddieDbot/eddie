import { Composition, registerRoot } from "remotion";
import {
  NewsShort,
  NewsShortSchema,
  calculateMetadata,
} from "./compositions/NewsShort";
import {
  RankingShort,
  RankingShortSchema,
  calculateRankingMetadata,
} from "./compositions/RankingShort";

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
      <Composition
        id="RankingShort"
        component={RankingShort}
        calculateMetadata={calculateRankingMetadata}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        schema={RankingShortSchema}
        defaultProps={{
          title: "Top 5 AI Models Right Now",
          items: [
            { rank: 5, label: "Gemini Ultra", detail: "Google's contender" },
            { rank: 4, label: "Claude Opus", detail: "Anthropic's flagship" },
            { rank: 3, label: "Llama 4", detail: "Meta's open weight giant" },
            { rank: 2, label: "GPT-5", detail: "OpenAI's latest" },
            { rank: 1, label: "EDDIE", detail: "Obviously" },
          ],
          emotionTarget: "Wow" as const,
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
