import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { BookOpen } from "lucide-react"
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isRootNode,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical"
import { parseTopicMentions, topicMention } from "../shared/topic-mentions"

type Topic = { id: string; title: string }

class TopicMentionNode extends TextNode {
  __topicId: string

  static getType() {
    return "topic-mention"
  }

  static clone(node: TopicMentionNode) {
    return new TopicMentionNode(node.__topicId, node.__text, node.__key)
  }

  static importJSON(json: Spread<{ topicId: string }, SerializedTextNode>) {
    return $createTopicMentionNode(json.topicId, json.text.slice(1)).updateFromJSON(json)
  }

  constructor(topicId: string, text: string, key?: NodeKey) {
    super(text, key)
    this.__topicId = topicId
  }

  exportJSON() {
    return { ...super.exportJSON(), topicId: this.__topicId }
  }

  createDOM(config: EditorConfig) {
    const element = super.createDOM(config)
    element.className =
      "inline-block max-w-[15rem] truncate align-baseline rounded-md border border-learning-ink/10 bg-learning-sage/60 px-1.5 py-0.5 text-xs font-medium leading-4 text-learning-ink"
    element.title = this.__text
    return element
  }

  isTextEntity() {
    return true
  }

  canInsertTextBefore() {
    return false
  }

  canInsertTextAfter() {
    return false
  }
}

function $createTopicMentionNode(topicId: string, title: string) {
  return $applyNodeReplacement(
    new TopicMentionNode(topicId, `@${title}`).setMode("token"),
  )
}

class TopicOption extends MenuOption {
  constructor(readonly topic: Topic) {
    super(topic.id)
  }
}

function serialize(node: LexicalNode): string {
  if (node instanceof TopicMentionNode)
    return topicMention(node.__topicId, node.getTextContent().slice(1))
  if ($isLineBreakNode(node)) return "\n"
  if ($isTextNode(node)) return node.getTextContent()
  if ($isRootNode(node)) return node.getChildren().map(serialize).join("\n")
  if ($isElementNode(node)) return node.getChildren().map(serialize).join("")
  return ""
}

function SubmitOnEnter({ onSubmit }: { onSubmit: () => void }) {
  const [editor] = useLexicalComposerContext()
  // Lexical owns keyboard handling inside the editor, so submit is registered as an editor command.
  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || event.shiftKey || event.isComposing) return false
          event.preventDefault()
          onSubmit()
          return true
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, onSubmit],
  )
  return null
}

function TopicTypeahead({ topics }: { topics: Topic[] }) {
  const [editor] = useLexicalComposerContext()
  const [query, setQuery] = useState<string | null>(null)
  const trigger = useBasicTypeaheadTriggerMatch("@", {
    minLength: 0,
    maxLength: 60,
    allowWhitespace: true,
  })
  const search = query?.toLowerCase() ?? ""
  const options = topics
    .filter((topic) => topic.title.toLowerCase().includes(search))
    .slice(0, 8)
    .map((topic) => new TopicOption(topic))

  return (
    <LexicalTypeaheadMenuPlugin
      options={options}
      onQueryChange={setQuery}
      triggerFn={trigger}
      commandPriority={COMMAND_PRIORITY_NORMAL}
      onSelectOption={(option, textNode, closeMenu) => {
        editor.update(() => {
          const mention = $createTopicMentionNode(option.topic.id, option.topic.title)
          if (textNode) textNode.replace(mention)
          const space = $createTextNode(" ")
          mention.insertAfter(space)
          space.select()
          closeMenu()
        })
      }}
      menuRenderFn={(anchor, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (!anchor.current) return null
        return createPortal(
          // The composer sits at the bottom of the window, so the menu opens above the caret.
          <div className="absolute bottom-[calc(100%+1.75rem)] left-0 z-50 w-72 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
            <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
              Tag a topic
            </p>
            {options.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {topics.length === 0 ? "Create a topic to tag it here." : "No matching topics"}
              </p>
            ) : (
              <ul role="listbox" aria-label="Topics">
                {options.map((option, index) => (
                  <li
                    key={option.key}
                    ref={(element) => option.setRefElement(element)}
                    role="option"
                    aria-selected={selectedIndex === index}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      selectOptionAndCleanUp(option)
                    }}
                  >
                    <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{option.topic.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          anchor.current,
        )
      }}
    />
  )
}

export function TopicMentionInput({
  label,
  initialValue,
  topics,
  placeholder,
  autoFocus,
  className,
  onChange,
  onSubmit,
}: {
  label: string
  initialValue: string
  topics: Topic[]
  placeholder: string
  autoFocus?: boolean
  className: string
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "edu-composer",
        nodes: [TopicMentionNode],
        onError: (error) => {
          throw error
        },
        editorState: () => {
          const paragraph = $createParagraphNode()
          const append = (text: string) =>
            text.split("\n").forEach((line, index) => {
              if (index > 0) paragraph.append($createLineBreakNode())
              if (line) paragraph.append($createTextNode(line))
            })
          let cursor = 0
          for (const mention of parseTopicMentions(initialValue)) {
            append(initialValue.slice(cursor, mention.start))
            const title =
              topics.find((topic) => topic.id === mention.id)?.title ?? mention.title
            paragraph.append($createTopicMentionNode(mention.id, title))
            cursor = mention.end
          }
          append(initialValue.slice(cursor))
          $getRoot().append(paragraph)
        },
      }}
    >
      <div className="relative">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={label}
              className={`overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-4 pb-3 pt-3 text-sm leading-relaxed outline-none [overflow-wrap:anywhere] ${className}`}
            />
          }
          placeholder={
            <p className="pointer-events-none absolute left-4 top-3 select-none text-sm leading-relaxed text-muted-foreground">
              {placeholder}
            </p>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      {autoFocus && <AutoFocusPlugin defaultSelection="rootEnd" />}
      <OnChangePlugin
        ignoreSelectionChange
        onChange={(state) => onChange(state.read(() => serialize($getRoot())))}
      />
      <TopicTypeahead topics={topics} />
      <SubmitOnEnter onSubmit={onSubmit} />
    </LexicalComposer>
  )
}
