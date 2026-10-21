import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
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
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRootNode,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
  TextNode,
  RootNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical"
import { Badge } from "@edu/ui/badge"
import { parseScratchpadCommand, scratchpadCommands } from "../shared/scratchpad-commands"
import { parseTopicMentions, topicMention } from "../shared/topic-mentions"
import type { Snapshot } from "../shared/contracts"

type Topic = Pick<Snapshot["topics"][number], "id" | "title" | "archived" | "state">

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
      "inline-block max-w-[15rem] truncate align-middle rounded-md border border-learning-ink/10 bg-learning-sage/60 px-1.5 py-0.5 text-xs font-medium leading-4 text-learning-ink"
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

class ScratchpadCommandNode extends TextNode {
  static getType() {
    return "scratchpad-command"
  }

  static clone(node: ScratchpadCommandNode) {
    return new ScratchpadCommandNode(node.__text, node.__key)
  }

  static importJSON(json: SerializedTextNode) {
    return $applyNodeReplacement(new ScratchpadCommandNode(json.text)).updateFromJSON(json)
  }

  createDOM(config: EditorConfig) {
    const element = super.createDOM(config)
    element.className = "rounded-md border border-learning-ink/10 bg-learning-sage/60 px-1 py-0.5 font-medium text-learning-ink"
    element.dataset.scratchpadCommand = this.__text
    return element
  }

  isTextEntity() {
    return true
  }
}

function ScratchpadCommands() {
  const [editor] = useLexicalComposerContext()
  // The root transform also removes highlighting when an edit moves a command away from the start.
  useEffect(() => editor.registerNodeTransform(RootNode, (root) => {
    const first = root.getFirstChild()
    let start = first
    if ($isElementNode(first)) start = first.getFirstChild()
    for (const node of root.getAllTextNodes()) {
      if (!(node instanceof ScratchpadCommandNode)) continue
      const command = parseScratchpadCommand(node.getTextContent())
      const following = node.getNextSibling()?.getTextContent() ?? ""
      if (node !== start || !command || node.getTextContent() !== command.command || (following && !/^\s/.test(following))) {
        const replacement = $createTextNode(node.getTextContent())
        node.replace(replacement)
        if (node === start) start = replacement
      }
    }
    if (!$isTextNode(start) || start instanceof TopicMentionNode || start instanceof ScratchpadCommandNode) return
    const command = parseScratchpadCommand(root.getTextContent())
    if (!command || !start.getTextContent().startsWith(command.command)) return
    const [prefix] = start.splitText(command.command.length)
    prefix.replace($applyNodeReplacement(new ScratchpadCommandNode(command.command)))
  }), [editor])
  return null
}

class CommandOption extends MenuOption {
  constructor(readonly command: (typeof scratchpadCommands)[number]) {
    super(command.command)
  }
}

function CommandTypeahead() {
  const [editor] = useLexicalComposerContext()
  const [query, setQuery] = useState<string | null>(null)
  const options = scratchpadCommands
    .filter(({ command }) => command.startsWith(`/${query ?? ""}`))
    .map((command) => new CommandOption(command))

  return (
    <LexicalTypeaheadMenuPlugin
      options={options}
      onQueryChange={setQuery}
      commandPriority={COMMAND_PRIORITY_NORMAL}
      triggerFn={(text) => {
        const selection = $getSelection()
        const first = $getRoot().getFirstChild()
        if (!$isRangeSelection(selection) || !$isElementNode(first) || selection.anchor.getNode() !== first.getFirstChild()) return null
        if (!/^\/[a-z-]*$/.test(text) || !scratchpadCommands.some(({ command }) => command.startsWith(text))) return null
        return { leadOffset: 0, matchingString: text.slice(1), replaceableString: text }
      }}
      onSelectOption={(option, textNode, closeMenu) => {
        editor.update(() => {
          if (!textNode) return
          const command = $applyNodeReplacement(new ScratchpadCommandNode(option.command.command))
          textNode.replace(command)
          const space = $createTextNode(" ")
          command.insertAfter(space)
          space.select()
          closeMenu()
        })
      }}
      menuRenderFn={(anchor, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        const container = editor.getRootElement()?.parentElement
        if (!anchor.current || !container) return null
        return createPortal(
          <div className="absolute inset-x-0 bottom-full z-50 mb-3 rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
            <ul role="listbox" aria-label="Scratchpad commands">
              {options.map((option, index) => (
                <li
                  key={option.key}
                  id={`typeahead-item-${index}`}
                  ref={(element) => option.setRefElement(element)}
                  role="option"
                  aria-selected={selectedIndex === index}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    selectOptionAndCleanUp(option)
                  }}
                >
                  <span className="shrink-0 font-medium">{option.command.command}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{option.command.description}</span>
                  <Badge variant={option.command.type}>{option.command.label}</Badge>
                </li>
              ))}
            </ul>
          </div>,
          container,
        )
      }}
    />
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
    .sort((left, right) => {
      if (left.archived === right.archived) return 0
      if (left.archived) return 1
      return -1
    })
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
              <ul role="listbox" aria-label="Scratchpads">
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
                    <Badge variant={option.topic.state?.type ?? "topic"}>
                      {{ topic: "Topic", test: "Test", generic: "Generic" }[option.topic.state?.type ?? "topic"]}
                    </Badge>
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
        nodes: [TopicMentionNode, ScratchpadCommandNode],
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
      <ScratchpadCommands />
      <HistoryPlugin />
      {autoFocus && <AutoFocusPlugin defaultSelection="rootEnd" />}
      <OnChangePlugin
        ignoreSelectionChange
        onChange={(state) => onChange(state.read(() => serialize($getRoot())))}
      />
      <CommandTypeahead />
      <TopicTypeahead topics={topics} />
      <SubmitOnEnter onSubmit={onSubmit} />
    </LexicalComposer>
  )
}
