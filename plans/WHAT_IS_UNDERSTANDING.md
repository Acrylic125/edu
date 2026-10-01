# What is understanding?

## Terminology
- **Understanding** is how much the student's reasoning matches what needs to be understood.
- **Line of Reasoning** is the student's justification for a question OR follow up.
- **Foundational Concepts** are topic/subtopic concept dependencies.
- **Carelessness** is the failed application of Foundaitonal concepts for what needs to be understood.

## Carelessness VS Understanding
Carelessness **DOES NOT IMPLY** lack of understanding of the **WHAT NEEDS TO BE UNDERSTOOD**.

## Example

What needs to be understood:
```
When a function is called, a stack frame is created to hold information specific to that function call, such as its local variables and return address. When the function returns, that frame is removed.
```

**Question: Why does each function call need its own stack frame, and what happens to that frame when the function finishes?**

### Understood Case
```
Each function call needs its own temporary storage because different calls can have different local variables and need to remember where to return afterward. That information is stored in a stack frame. When the function finishes, that information is no longer needed, so the frame is removed from the stack.
```

### Negative case, partial understanding
```
A function gets a stack frame because functions go on the stack. When the function is done, the stack frame gets deleted.
```

## Evaluation Checklist

- **Conciseness**, straight to the point in plain terms
- **Usage of Topic Terminology**, correct usage of topic terminology
- **Clear Logical Flow**, Reasoning progresses in small, justified steps, where each step can be readily derived from the previous one using what needs to be understood.
